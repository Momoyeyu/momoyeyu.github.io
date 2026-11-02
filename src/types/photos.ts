export interface PhotoAlbum {
    slug: string;
    title: string;
    subtitle: string;
    source: string;
    cover: string;
    location?: { longitude: number; latitude: number };
}
export interface LibraryPhoto {
    id: string;
    src: string;
    title: string;
    album: string;
    width: number;
    height: number;
    source: string;
    defaultCover: boolean;
}
export interface PhotoLibrary { albums: PhotoAlbum[]; photos: LibraryPhoto[] }
