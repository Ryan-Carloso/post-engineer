// hook-photo-i18n — copy for the First photo section on the post detail page
// (issue #589). Merged into `posts` in ./index.ts
// (en.ts/pt.ts are over the file-size cap and may not grow).
//
// The copy deliberately never claims the hook used this photo: the section
// shows the first photo of the video, and videos generated before #589
// opened the hook with the persona avatar instead — so a hook-usage claim
// would be false for every historical slot. On videos generated with the
// current behavior the first photo IS the hook photo.
export const hookPhotoStrings = {
  pt: {
    posts: {
      hookPhotoLabel: 'Primeira foto',
      hookPhotoAlt: 'Primeira foto',
      hookPhotoSegmentNote: 'Segmento {segment}, imagem {image}.',
      hookPhotoUploadNote:
        'Segmento {segment}, imagem {image} — enviada do seu dispositivo. O upload original só fica no serviço de vídeo por uma hora, por isso não pode ser mostrado aqui.',
      hookPhotoPersonaNote: 'Nenhuma foto foi enviada com este vídeo.',
    },
  },
  en: {
    posts: {
      hookPhotoLabel: 'First photo',
      hookPhotoAlt: 'First photo',
      hookPhotoSegmentNote: 'Segment {segment}, image {image}.',
      hookPhotoUploadNote:
        'Segment {segment}, image {image} — uploaded from your device. The original upload is only kept on the video service for an hour, so it cannot be shown here.',
      hookPhotoPersonaNote: 'No photo was sent with this video.',
    },
  },
} as const;
