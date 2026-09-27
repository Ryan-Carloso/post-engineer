import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { listDefaultPersonaFaces } from '@/lib/persona-faces';

//---------------
// GET /api/persona/faces — default house character/face catalog
// (public/caracter-samples). Same list as the UI picker.
// Includes gender/age/ethnicity/hair/description for MCP (cannot show photos).
// Auth = Supabase session (cookie) OR personal API key (Bearer/x-api-key, MCP).
//---------------

function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_APP_URL is not defined');
  }
  return url.replace(/\/+$/, '');
}

export async function GET(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  let baseUrl: string;
  try {
    baseUrl = appBaseUrl();
  } catch (error) {
    console.error('[api/persona/faces] env missing', { error });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Configuration error.' },
      { status: 500 },
    );
  }

  const faces = listDefaultPersonaFaces(baseUrl).map(
    ({ id, url, name, gender, age, ethnicity, hair, description }) => ({
      id,
      url,
      name,
      gender,
      age,
      ethnicity,
      hair,
      description,
    }),
  );

  return NextResponse.json({ faces });
}
