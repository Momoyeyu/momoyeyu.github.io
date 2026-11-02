import { describe, expect, it } from "vitest";
import { applyPhotoClassification } from "../plugins/photo-curation";
import type { PhotoLibrary } from "../types/photos";
const library: PhotoLibrary = {
    albums: [{slug:"unassigned",title:"待归类",subtitle:"",source:"",cover:"/img/a.webp"},{slug:"tokyo",title:"东京",subtitle:"",source:"",cover:"/img/b.webp"}],
    photos: [{id:"a",src:"/img/a.webp",title:"a",album:"unassigned",width:10,height:10,source:"a.jpg",defaultCover:true},{id:"b",src:"/img/b.webp",title:"b",album:"tokyo",width:10,height:10,source:"b.jpg",defaultCover:true}],
};
describe("photo classification", () => {
    it("moves photos, updates covers and can add a place without mutating the original", () => {
        const result = applyPhotoClassification(library,{albums:[{slug:"osaka",title:"大阪",location:{longitude:135.5,latitude:34.7}}],assignments:[{photoId:"a",album:"osaka",previousAlbum:"unassigned"}]});
        expect(result.photos[0].album).toBe("osaka");
        expect(result.albums[2].cover).toBe("/img/a.webp");
        expect(library.photos[0].album).toBe("unassigned");
    });
    it("rejects stale and invalid changes and accepts already applied changes", () => {
        expect(()=>applyPhotoClassification(library,{assignments:[{photoId:"b",album:"unassigned",previousAlbum:"osaka"}]})).toThrow("照片已被修改");
        expect(()=>applyPhotoClassification(library,{assignments:[{photoId:"missing",album:"tokyo",previousAlbum:"unassigned"}]})).toThrow();
        expect(()=>applyPhotoClassification(library,{albums:[{slug:"bad/path",title:"bad"}],assignments:[]})).toThrow();
        expect(applyPhotoClassification(library,{assignments:[{photoId:"b",album:"tokyo",previousAlbum:"unassigned"}]}).photos[1].album).toBe("tokyo");
    });
});
