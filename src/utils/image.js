export const THUMBNAIL_TYPE = {
    PDF: 'pdf',
    IMAGE: 'image',
    URL: 'url',
    UNKNOWN: 'unknown'
};

export function getThumbnailType(file) {
    let thumbnailType = THUMBNAIL_TYPE.UNKNOWN;

    if (file) {
        if ('url' in file) {
            thumbnailType = THUMBNAIL_TYPE.URL;
        } else if (/image\//.test(file.type)) {
            thumbnailType = THUMBNAIL_TYPE.IMAGE;
        } else if (/application\/pdf/.test(file.type)) {
            thumbnailType = THUMBNAIL_TYPE.PDF;
        }
    }

    return thumbnailType;
}
