<script lang="ts">
    import { onMount } from 'svelte';
    import I18nKey from '../i18n/i18nKey';
    import { i18n } from '../i18n/translation';
    export let groups: {title:string;desc:string;links:{name:string;url:string;avatar:string;descr:string}[]}[];
    let current = 0, selectedPlanet = -1, dockX = -1000;
    let nav:HTMLElement, sky:HTMLCanvasElement;
    let animate = false;
    const wrap = (n:number) => ((n % groups.length) + groups.length) % groups.length;
    $: serials = [current-1,current,current+1];
    const dockScale = (index:number,x:number) => {
        if(!nav || x<0)return 1;
        const button=nav.querySelectorAll('button')[index+1] as HTMLElement;
        return button ? 1+.35*Math.max(0,1-Math.abs(x-(button.offsetLeft+button.offsetWidth/2))/140) : 1;
    };
    let scene: HTMLElement;
    let travel = 0;
    const constellation = Array.from({length:26},(_,i)=>({x:120+(i*.618034)%1*760,y:95+(i*.414214)%1*430}));
    const node = (index:number,count:number) => { const angle = index / count * Math.PI*2 - Math.PI/2; return {x:50+Math.cos(angle)*33,y:49+Math.sin(angle)*31}; };
    const select = (n:number) => { current=n; selectedPlanet=-1; };
    const jump = (index:number) => {const delta=wrap(index-wrap(current)+1)-1;select(current+delta);};
    function keys(e:KeyboardEvent) {if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();select(current+(e.key==='ArrowRight'?1:-1));}}
    let touchX=0, lastWheel=0;
    function wheel(e:WheelEvent) { if(Math.abs(e.deltaX)<=Math.abs(e.deltaY)||e.deltaX===0)return; e.preventDefault();e.stopPropagation();if(Math.abs(e.deltaX)<10)return;if(performance.now()-lastWheel>850){select(current+(e.deltaX>0?1:-1));lastWheel=performance.now();} }

    onMount(()=>{
        const reduced=matchMedia('(prefers-reduced-motion: reduce)'); animate=!reduced.matches;
        const ctx=sky.getContext('2d');let frame=0,visible=true,last=0;
        let width=1,height=1;
        const measure=()=>{const r=sky.getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio,2);sky.width=Math.round(width*dpr);sky.height=Math.round(height*dpr);ctx?.setTransform(dpr,0,0,dpr,0,0);};
        const observer=new ResizeObserver(measure);observer.observe(sky);
        const visibility=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)wake();});visibility.observe(scene);
        let ink=getComputedStyle(scene).getPropertyValue('--text-secondary').trim();
        const color=()=>{ink=getComputedStyle(scene).getPropertyValue('--text-secondary').trim();};
        const theme=new MutationObserver(color);theme.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
        const draw=(time:number)=>{
            frame=0;if(!visible||document.hidden)return;
            if(time-last<30){frame=requestAnimationFrame(draw);return;}last=time;
            const r=scene.getBoundingClientRect();travel=Math.max(0,Math.min(1,-r.top/(r.height*.75)));
            if(ctx){ctx.clearRect(0,0,width,height);ctx.fillStyle=ink;
                for(let i=0;i<360;i++){
                    const seed=(i*.6180339)%1,phase=time/1000;
                    const p=Math.max(0,Math.min(1,(travel-seed*.08)/.92));
                    const arc=Math.sin(p*Math.PI);
                    const fromX=(i*.754877)%1*width,fromY=(i*.56984)%1*height;
                    const x=fromX+(width*(.15+seed*.7)-fromX)*p+arc*(seed-.5)*150+(animate?Math.sin(phase*.48+seed*37)*3:0);
                    const y=fromY+(height*.95-fromY)*p-arc*(30+Math.sin(seed*17)*70)+(animate?Math.cos(phase*.37+seed*23)*2:0);
                    ctx.globalAlpha=(.2+.5*(.5+.5*Math.sin(phase*1.1+seed*29)))*(.4+arc*.5);
                    const size=seed>.95?1.6:.8;ctx.fillRect(x,y,size,size);
                    if(seed>.985){ctx.globalAlpha*=.3;ctx.fillRect(x-3,y+.5,7,.5);ctx.fillRect(x+.5,y-3,.5,7);}
                }ctx.globalAlpha=1;
            }
            if(animate)frame=requestAnimationFrame(draw);
        };
        const wake=()=>{if(!frame&&visible&&!document.hidden)frame=requestAnimationFrame(draw)};
        const motion=()=>{animate=!reduced.matches;wake()};reduced.addEventListener('change',motion);
        window.addEventListener('scroll',wake,{passive:true});document.addEventListener('visibilitychange',wake);measure();wake();
        return()=>{observer.disconnect();visibility.disconnect();theme.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',wake);document.removeEventListener('visibilitychange',wake);reduced.removeEventListener('change',motion)};
    });

</script>
<section class="galaxy-scene" bind:this={scene} style={`--travel:${travel}`}>
    <canvas class="living-sky" bind:this={sky} aria-hidden="true"></canvas>
    <div class="galaxy-stage" role="region" aria-label={i18n(I18nKey.friends)} tabindex="0" on:keydown={keys} on:wheel|nonpassive={wheel} on:touchstart={e=>touchX=e.touches[0].clientX} on:touchend={e=>{const delta=e.changedTouches[0].clientX-touchX;if(Math.abs(delta)>50)select(current+(delta<0?1:-1));}}>
        {#each serials as serial (serial)}
            {@const index=wrap(serial)}
            {@const group=groups[index]}
            {@const offset=serial-current}
            <section class="galaxy" class:near={serial===current} style={`--offset:${offset};--depth:${Math.abs(offset)}`} inert={serial!==current} aria-hidden={serial!==current}>
                <svg class="orbits" class:living={animate} viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
                    <g class="constellation">{#each constellation as point,i}{#if i>0}<path d={`M${point.x} ${point.y} L${constellation[Math.max(0,i-3)].x} ${constellation[Math.max(0,i-3)].y}`}/>{/if}<circle cx={point.x} cy={point.y} r={i%5===0?2.8:1.6}/>{/each}</g>
                    <ellipse cx="500" cy="305" rx="345" ry="185"/><ellipse cx="500" cy="305" rx="390" ry="230"/><ellipse cx="500" cy="305" rx="280" ry="260" transform="rotate(-24 500 305)"/>
                    {#each group.links as link,i}{@const p=node(i,group.links.length)}<path class:lit={selectedPlanet===i} d={`M500 305 Q${p.x*10} 305 ${p.x*10} ${p.y*6.2}`}/>{#if animate && serial===current}<circle r="1.8" class="traveller"><animateMotion dur={`${7+i*1.3}s`} repeatCount="indefinite" path={`M500 305 Q${p.x*10} 305 ${p.x*10} ${p.y*6.2}`} /></circle>{/if}{/each}
                </svg>
                <div class="galaxy-core"><span class="core-ring">✧</span><h1>{group.title}</h1><p>{group.desc}</p></div>
                {#each group.links as link,i}{@const p=node(i,group.links.length)}
                    <a class="planet" on:mouseenter={()=>selectedPlanet=i} on:mouseleave={()=>selectedPlanet=-1} on:focus={()=>selectedPlanet=i} on:blur={()=>selectedPlanet=-1} href={link.url} target="_blank" rel="noopener noreferrer" style={`left:${p.x}%;top:${p.y}%;--phase:${i*-.7}s`}>
                        <img src={link.avatar} alt="" width="44" height="44" loading="lazy" on:error={e=>e.currentTarget.style.visibility='hidden'}/><span><strong>{link.name}</strong><small>{link.descr}</small></span>
                    </a>
                {/each}
            </section>
        {/each}
    </div>
    <nav class="galaxy-navigation" bind:this={nav} aria-label={i18n(I18nKey.friends)} on:mousemove={e=>dockX=e.clientX-nav.getBoundingClientRect().left} on:mouseleave={()=>dockX=-1000}><button on:click={()=>select(current-1)} aria-label={i18n(I18nKey.previousAlbum)}>←</button>{#each groups as group,index}<button class:active={wrap(current)===index} aria-pressed={wrap(current)===index} style={`--scale:${dockScale(index,dockX)}`} on:click={()=>jump(index)}>{group.title}</button>{/each}<button on:click={()=>select(current+1)} aria-label={i18n(I18nKey.nextAlbum)}>→</button></nav>
</section>
<style>
.galaxy-scene {position:relative;isolation:isolate;overflow:clip;margin-top:1rem;padding-bottom:5rem;color:var(--text-primary)}
.living-sky {position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1}
.star-field {position:absolute;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(ellipse at 50% 40%,color-mix(in srgb,var(--primary) 7%,transparent),transparent 65%)}
.star-field i {position:absolute;background:var(--primary);border-radius:50%;opacity:.45;transform:translate(calc(var(--travel)*var(--dx)),calc(var(--travel)*var(--dy)));animation:glint 5s var(--delay) infinite alternate}
@keyframes glint {to{opacity:.15}}
.galaxy-stage {position:relative;height:clamp(540px,48vw,720px);perspective:1100px;touch-action:pan-y;overscroll-behavior-x:none;outline-offset:-4px}
.galaxy {position:absolute;inset:0;transform:translateX(calc(var(--offset)*69%)) translateZ(calc(-1*var(--depth)*420px)) rotateY(calc(var(--offset)*-22deg));opacity:.18;filter:blur(1px);transition:transform 850ms cubic-bezier(.22,1,.36,1),opacity 650ms,filter 650ms;pointer-events:none}
.galaxy.near {opacity:1;filter:none;pointer-events:auto}
.orbits {position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:var(--primary);stroke-width:.8;opacity:.2}
.orbits path {stroke-dasharray:4 7;opacity:.45;transition:opacity 300ms,stroke-width 300ms}
.orbits path.lit {opacity:1;stroke-width:2;stroke-dasharray:900;animation:find-route 2.4s cubic-bezier(.3,.1,.3,1) both}
.constellation {opacity:.5}.constellation path{stroke-dasharray:none;stroke-width:.6}.constellation circle{fill:var(--primary);stroke:none}
.orbits .traveller {fill:var(--primary);stroke:none;opacity:1;filter:drop-shadow(0 0 4px var(--primary))}
.orbits.living ellipse {transform-origin:50% 49%;animation:orbit-breathe 12s ease-in-out infinite alternate}
.orbits.living ellipse:nth-child(2){animation-delay:-4s}.orbits.living ellipse:nth-child(3){animation-delay:-8s}
@keyframes orbit-breathe {to {transform:rotate(5deg) scale(.97,1.02);opacity:.5}}
@keyframes find-route {from{stroke-dashoffset:900}to{stroke-dashoffset:0}}

.galaxy-core {position:absolute;left:50%;top:49%;transform:translate(-50%,-50%);text-align:center;max-width:14rem}
.core-ring {display:grid;place-items:center;width:5.5rem;height:5.5rem;border:1px solid color-mix(in srgb,var(--primary) 30%,transparent);border-radius:50%;margin:0 auto 1rem;font-size:2.5rem;box-shadow:0 0 65px color-mix(in srgb,var(--primary) 12%,transparent)}
 .core-ring {animation:core-pulse 4s ease-in-out infinite alternate}
@keyframes core-pulse {to{box-shadow:0 0 90px color-mix(in srgb,var(--primary) 23%,transparent);transform:scale(1.045)}}
h1 {font-family:var(--font-display);font-size:1.8rem;font-weight:400}
.galaxy-core p {font-size:.7rem;color:var(--text-secondary);line-height:1.8;margin-top:.5rem}
.planet {position:absolute;transform:translate(-50%,-50%);display:flex;gap:.75rem;align-items:center;width:14rem;padding:.6rem;transition:color 200ms,translate 250ms}
.planet:hover {color:var(--primary);translate:0 -4px}
.planet img {border-radius:50%;object-fit:cover;width:2.75rem;height:2.75rem;background:var(--btn-regular-bg);box-shadow:0 0 24px color-mix(in srgb,var(--primary) 10%,transparent)}
.planet span {min-width:0}.planet strong {font-weight:500;font-size:.85rem}.planet small {display:block;font-size:.65rem;color:var(--text-secondary);line-height:1.7;margin-top:.25rem}
.galaxy-navigation {position:relative;width:max-content;max-width:100%;margin-inline:auto;display:flex;justify-content:center;gap:1.5rem;align-items:center;font-size:.8rem;color:var(--text-secondary)}
.galaxy-navigation button {padding:.75rem .5rem;transform-origin:50% 100%;transform:scale(var(--scale,1));transition:transform 180ms cubic-bezier(.22,1,.36,1),color 180ms}.galaxy-navigation .active {color:var(--text-primary);text-decoration:underline;text-underline-offset:.6rem}
@media(max-width:650px){.galaxy-stage{height:690px}.galaxy-core{top:46%;max-width:9rem}.core-ring{width:3.5rem;height:3.5rem}.planet{width:9rem;gap:.4rem;flex-direction:column;text-align:center}.planet img{width:2rem;height:2rem}.planet small{font-size:.6rem}.planet strong{font-size:.75rem}.galaxy-navigation{gap:.8rem}.orbits{opacity:.12}}
@media(prefers-reduced-motion:reduce){.galaxy,.galaxy-navigation button{transition:none}.core-ring,.orbits ellipse,.orbits path{animation:none}.star-field i{animation:none;transform:none}.planet{transition:none}}
</style>
