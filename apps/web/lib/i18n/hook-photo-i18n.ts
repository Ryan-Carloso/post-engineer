// hook-photo-i18n — copy for the Hook photo section on the post detail page
// (issue #589). Merged into `posts` in ./index.ts
// (en.ts/pt.ts are over the file-size cap and may not grow).
export const hookPhotoStrings = {
  pt: {
    posts: {
      hookPhotoLabel: 'Foto do hook',
      hookPhotoAlt: 'Foto do hook',
      hookPhotoSegmentNote:
        'Segmento {segment}, imagem {image} — o hook com lip sync abre com esta foto.',
      hookPhotoUploadNote:
        'Segmento {segment}, imagem {image} — enviada do seu dispositivo. O hook abre com esta foto; o upload original só fica no serviço de vídeo por uma hora, por isso não pode ser mostrado aqui.',
      hookPhotoPersonaNote:
        'Nenhuma foto foi enviada com este vídeo, por isso o hook abre com a foto da persona — a foto exata não está guardada neste post.',
    },
  },
  en: {
    posts: {
      hookPhotoLabel: 'Hook photo',
      hookPhotoAlt: 'Hook photo',
      hookPhotoSegmentNote:
        'Segment {segment}, image {image} — the lip-sync hook opens with this photo.',
      hookPhotoUploadNote:
        'Segment {segment}, image {image} — uploaded from your device. The hook opens with this photo; the original upload is only kept on the video service for an hour, so it cannot be shown here.',
      hookPhotoPersonaNote:
        'No photo was sent with this video, so the hook opens with the persona photo — the exact photo is not stored on this post.',
    },
  },
} as const;
