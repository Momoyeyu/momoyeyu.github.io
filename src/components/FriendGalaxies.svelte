<script lang="ts">
    import { onMount } from 'svelte';
    import I18nKey from '../i18n/i18nKey';
    import { i18n } from '../i18n/translation';
    export let groups: {title:string;desc:string;links:{name:string;url:string;avatar:string;descr:string}[]}[];
    let current = 0;
    let scene: HTMLElement;
    let travel = 0;
    const stars = Array.from({length:120},(_,i)=>({x:(i*61.803)%100,y:(i*37.317)%100,size:i%9===0?2:1,seed:(i*0.61803)%1}));
    const node = (index:number,count:number) => { const angle = index / count * Math.PI*2 - Math.PI/2; return {x:50+Math.cos(angle)*33,y:49+Math.sin(angle)*31}; };
    const select = (n:number) => current=(n+groups.length)%groups.length;
    function keys(e:KeyboardEvent) {if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();select(current+(e.key==='ArrowRight'?1:-1));}}
    let touchX=0;
    onMount(()=>{
        let frame=0;
        const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const r=scene.getBoundingClientRect();travel=Math.max(0,Math.min(1,-r.top/(r.height*.85)));});};
        window.addEventListener('scroll',update,{passive:true});update();
        return()=>{window.removeEventListener('scroll',update);cancelAnimationFrame(frame);};
    });
</script>
<section class="galaxy-scene" bind:this={scene} style={`--travel:${travel}`}>
    <div class="star-field" aria-hidden="true">{#each stars as star}<i style={`left:${star.x}%;top:${star.y}%;width:${star.size}px;height:${star.size}px;--dx:${(star.seed-.5)*220}px;--dy:${-120-star.seed*240}px;--delay:${star.seed*4}s`}></i>{/each}</div>
    <div class="galaxy-stage" role="region" aria-label={i18n(I18nKey.friends)} tabindex="0" on:keydown={keys} on:touchstart={e=>touchX=e.touches[0].clientX} on:touchend={e=>{const delta=e.changedTouches[0].clientX-touchX;if(Math.abs(delta)>50)select(current+(delta<0?1:-1));}}>
        {#each groups as group,index}
            {@const offset = index-current}
            <section class="galaxy" class:near={index===current} style={`--offset:${offset}`} inert={index!==current} aria-hidden={index!==current}>
                <svg class="orbits" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
                    <ellipse cx="500" cy="305" rx="345" ry="185"/><ellipse cx="500" cy="305" rx="390" ry="230"/><ellipse cx="500" cy="305" rx="280" ry="260" transform="rotate(-24 500 305)"/>
                    {#each group.links as link,i}{@const p=node(i,group.links.length)}<path d={`M500 305 Q${p.x*10} 305 ${p.x*10} ${p.y*6.2}`}/>{/each}
                </svg>
                <div class="galaxy-core"><span class="core-ring">✧</span><h1>{group.title}</h1><p>{group.desc}</p></div>
                {#each group.links as link,i}{@const p=node(i,group.links.length)}
                    <a class="planet" href={link.url} target="_blank" rel="noopener noreferrer" style={`left:${p.x}%;top:${p.y}%`}>
                        <img src={link.avatar} alt="" width="44" height="44" loading="lazy" on:error={e=>e.currentTarget.style.visibility='hidden'}/><span><strong>{link.name}</strong><small>{link.descr}</small></span>
                    </a>
                {/each}
            </section>
        {/each}
    </div>
    <nav class="galaxy-navigation" aria-label={i18n(I18nKey.friends)}><button on:click={()=>select(current-1)} aria-label={i18n(I18nKey.previousAlbum)}>←</button>{#each groups as group,index}<button class:active={current===index} aria-pressed={current===index} on:click={()=>select(index)}>{group.title}</button>{/each}<button on:click={()=>select(current+1)} aria-label={i18n(I18nKey.nextAlbum)}>→</button></nav>
</section>
<style>
.galaxy-scene {position:relative;isolation:isolate;overflow:clip;margin-top:1rem;padding-bottom:5rem;color:var(--text-primary)}
.star-field {position:absolute;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(ellipse at 50% 40%,color-mix(in srgb,var(--primary) 7%,transparent),transparent 65%)}
.star-field i {position:absolute;background:var(--primary);border-radius:50%;opacity:.45;transform:translate(calc(var(--travel)*var(--dx)),calc(var(--travel)*var(--dy)));animation:glint 5s var(--delay) infinite alternate}
@keyframes glint {to{opacity:.15}}
.galaxy-stage {position:relative;height:clamp(540px,48vw,720px);perspective:1100px;touch-action:pan-y;outline-offset:-4px}
.galaxy {position:absolute;inset:0;transform:translateX(calc(var(--offset)*69%)) translateZ(calc(-1*abs(var(--offset))*420px)) rotateY(calc(var(--offset)*-22deg));opacity:.18;filter:blur(1px);transition:transform 850ms cubic-bezier(.22,1,.36,1),opacity 650ms,filter 650ms;pointer-events:none}
.galaxy.near {opacity:1;filter:none;pointer-events:auto}
.orbits {position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:var(--primary);stroke-width:.8;opacity:.2}
.orbits path {stroke-dasharray:3 5;opacity:.65}
.galaxy-core {position:absolute;left:50%;top:49%;transform:translate(-50%,-50%);text-align:center;max-width:14rem}
.core-ring {display:grid;place-items:center;width:5.5rem;height:5.5rem;border:1px solid color-mix(in srgb,var(--primary) 30%,transparent);border-radius:50%;margin:0 auto 1rem;font-size:2.5rem;box-shadow:0 0 65px color-mix(in srgb,var(--primary) 12%,transparent)}
h1 {font-family:var(--font-display);font-size:1.8rem;font-weight:400}
.galaxy-core p {font-size:.7rem;color:var(--text-secondary);line-height:1.8;margin-top:.5rem}
.planet {position:absolute;transform:translate(-50%,-50%);display:flex;gap:.75rem;align-items:center;width:14rem;padding:.6rem;transition:color 200ms,translate 250ms}
.planet:hover {color:var(--primary);translate:0 -4px}
.planet img {border-radius:50%;object-fit:cover;width:2.75rem;height:2.75rem;background:var(--btn-regular-bg);box-shadow:0 0 24px color-mix(in srgb,var(--primary) 10%,transparent)}
.planet span {min-width:0}.planet strong {font-weight:500;font-size:.85rem}.planet small {display:block;font-size:.65rem;color:var(--text-secondary);line-height:1.7;margin-top:.25rem}
.galaxy-navigation {display:flex;justify-content:center;gap:1.5rem;align-items:center;font-size:.8rem;color:var(--text-secondary)}
.galaxy-navigation button {padding:.5rem .25rem}.galaxy-navigation .active {color:var(--text-primary);text-decoration:underline;text-underline-offset:.6rem}
@media(max-width:650px){.galaxy-stage{height:690px}.galaxy-core{top:46%;max-width:9rem}.core-ring{width:3.5rem;height:3.5rem}.planet{width:9rem;gap:.4rem;flex-direction:column;text-align:center}.planet img{width:2rem;height:2rem}.planet small{font-size:.6rem}.planet strong{font-size:.75rem}.galaxy-navigation{gap:.8rem}.orbits{opacity:.12}}
@media(prefers-reduced-motion:reduce){.galaxy{transition:none}.star-field i{animation:none;transform:none}.planet{transition:none}}
</style>
