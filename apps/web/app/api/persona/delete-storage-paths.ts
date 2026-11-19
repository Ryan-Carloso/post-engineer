import type { SupabaseClient } from '@supabase/supabase-js';

export async function collectPersonaStoragePaths(
  supabase: SupabaseClient,
  persona: { photo_path: string | null; voice_audio_path: string | null },
  personaId: string,
  userId: string,
): Promise<{ paths: string[]; error: unknown }> {
  const paths = [persona.photo_path, persona.voice_audio_path].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const { data: libraryRows, error } = await supabase
    .from('persona_images')
    .select('image_path')
    .eq('persona_id', personaId)
    .eq('user_id', userId);
  if (error) return { paths, error };
  for (const row of libraryRows ?? []) {
    if (typeof row.image_path === 'string' && row.image_path.length > 0) {
      paths.push(row.image_path);
    }
  }
  return { paths, error: null };
}
