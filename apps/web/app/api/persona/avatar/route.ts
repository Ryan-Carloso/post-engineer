import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

//---------------
// POST /api/persona/avatar — MOCK do gerador de imagem por IA.
// Retorna um placeholder em data URL. Provedor real depois.
//---------------

const MOCK_AVATAR_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
      '<rect width="256" height="256" fill="#e5e5e5"/>' +
      '<circle cx="128" cy="100" r="48" fill="#a3a3a3"/>' +
      '<ellipse cx="128" cy="210" rx="80" ry="60" fill="#a3a3a3"/>' +
      '</svg>',
  );

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const prompt =
    typeof body === 'object' && body !== null && 'prompt' in body
      ? (body as { prompt: unknown }).prompt
      : undefined;

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Prompt é obrigatório' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    imageUrl: MOCK_AVATAR_URL,
  });
}
