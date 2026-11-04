import metadata from "./photo-library.json";
import assets from "./photo-assets.json";
import type { PhotoLibrary } from "../types/photos";
const byId = new Map(assets.map(asset => [asset.id, asset]));
const library: PhotoLibrary = { albums: metadata.albums, photos: metadata.photos.map(photo => ({ ...byId.get(photo.id)!, ...photo })) };
export default library;
