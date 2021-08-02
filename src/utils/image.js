export const THUMBNAIL_TYPE = {
    PDF: 'pdf',
    IMAGE: 'image',
    UNKNOWN: 'unknown'
};

export function getThumbnailType(file) {
    let thumbnailType = THUMBNAIL_TYPE.UNKNOWN;

    if (file) {
        if (/image\//.test(file.type)) {
            thumbnailType = THUMBNAIL_TYPE.IMAGE;
        } else if (/application\/pdf/.test(file.type)) {
            thumbnailType = THUMBNAIL_TYPE.PDF;
        }
    }

    return thumbnailType;
}

export async function getThumbnailData(filePromise) {
    const file = await filePromise;
    const thumbnailType = getThumbnailType(file);
    if (thumbnailType === THUMBNAIL_TYPE.IMAGE) {
        const url = await new Promise((resolve) => {
            const reader = new FileReader();

            reader.addEventListener('load', (event) => {
                resolve(event.target.result);
            });

            reader.readAsDataURL(file);
        });

        return { filename: '', thumbnail: url };
    } else {
        return { filename: file?.name ?? '', thumbnail: '' };
    }
}
