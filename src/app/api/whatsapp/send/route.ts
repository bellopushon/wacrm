import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    // Resolve the caller's account_id. Every downstream lookup is
    // account-scoped post-multi-user.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = await request.json();

    // The send core (shared with the public POST /api/v1/messages
    // endpoint) does all validation, the Meta call, persistence, and
    // the flow-run pause. We just translate body field names and map
    // its typed errors back to this route's response shape.
    const result = await sendMessageToConversation(supabase, accountId, {
      conversationId: body.conversation_id,
      messageType: body.message_type,
      contentText: body.content_text,
      mediaUrl: body.media_url,
      filename: body.filename,
      templateName: body.template_name,
      templateLanguage: body.template_language,
      templateParams: body.template_params,
      templateMessageParams: body.template_message_params,
      replyToMessageId: body.reply_to_message_id,
    });

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    });
  } catch (error) {
    if (error instanceof SendMessageError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error('Error in WhatsApp send POST:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}
