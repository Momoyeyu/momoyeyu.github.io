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

it("saves title and notes without losing metadata and rejects stale text edits", () => {
    const update = { photoId: "a", album: "tokyo", previousAlbum: "unassigned", title: "新标题", previousTitle: "a", note: "旅行记录", previousNote: "" };
    const result = applyPhotoClassification(library, { assignments: [update] });
    expect(result.photos[0]).toMatchObject({ title: "新标题", note: "旅行记录", album: "tokyo", src: "/img/a.webp" });
    expect(result.albums[0].cover).toBe("");
    expect(() => applyPhotoClassification(result, { assignments: [{ ...update, title: "覆盖" }] })).toThrow("照片文字已被修改");
    expect(() => applyPhotoClassification(library, { assignments: [{ ...update, note: "x".repeat(2001) }] })).toThrow();
    expect(library.photos[0].title).toBe("a");
});

it("edits album descriptions without changing photos and rejects stale updates", () => {
 const update={slug:"tokyo",title:"东京",subtitle:"沿河的灯火",previous:{title:"东京",subtitle:"",source:""}};
 const result=applyPhotoClassification(library,{assignments:[],albumUpdates:[update]});
 expect(result.albums[1]).toMatchObject({title:"东京",subtitle:"沿河的灯火"});
 expect(result.photos).toEqual(library.photos);
 expect(()=>applyPhotoClassification(result,{assignments:[],albumUpdates:[{...update,subtitle:"另一个描述"}]})).toThrow("相册已被修改");
 expect(()=>applyPhotoClassification(library,{assignments:[],albumUpdates:[{...update,title:""}]})).toThrow();
});

it("deletes only album metadata and reassigns every photo without losing asset or text data", () => {
 const result=applyPhotoClassification(library,{assignments:[],deleteAlbums:['tokyo']});
 expect(result.albums.some(album=>album.slug==='tokyo')).toBe(false);
 expect(result.photos).toHaveLength(library.photos.length);
 expect(result.photos[1]).toEqual({...library.photos[1],album:'travel-notes'});
 expect(result.albums.find(album=>album.slug==='travel-notes')?.cover).toBe('/img/b.webp');
 expect(library.photos[1].album).toBe('tokyo');
 expect(()=>applyPhotoClassification(result,{assignments:[],deleteAlbums:['travel-notes']})).toThrow('待归类不能删除');
 expect(()=>applyPhotoClassification(result,{assignments:[],deleteAlbums:['missing']})).toThrow('相册不存在');
});
