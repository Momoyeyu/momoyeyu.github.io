<script lang="ts">
    import {onMount} from 'svelte';
    let canvas:HTMLCanvasElement;
    onMount(()=>{
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const reduced=matchMedia('(prefers-reduced-motion: reduce)');
        let frame=0;
        const paint=()=>{
            frame=0;const r=canvas.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return;
            const w=r.width,h=r.height,dpr=Math.min(devicePixelRatio,2);
            if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
            ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
            const t=reduced.matches?.5:Math.max(0,Math.min(1,(innerHeight-r.top)/(innerHeight+h)));
            ctx.fillStyle=getComputedStyle(canvas).color;
            for(let i=0;i<220;i++){
                const seed=(i*.618034)%1,delay=seed*.15,p=Math.max(0,Math.min(1,(t-delay)/.85));
                const fromX=(i*.381966)%1*w,toX=w*.5+(seed-.5)*w*.8,arc=Math.sin(p*Math.PI);
                const x=fromX+(toX-fromX)*p+arc*(seed-.5)*80;
                const y=h*.15+p*h*.7+arc*Math.sin(seed*71)*h*.32;
                ctx.globalAlpha=(.15+seed*.4)*Math.sin(Math.PI*t);ctx.beginPath();ctx.arc(x,y,seed>.95?1.6:.8,0,Math.PI*2);ctx.fill();
            }
            ctx.globalAlpha=1;
        };
        const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(paint)};
        const resize=new ResizeObserver(update);resize.observe(canvas);window.addEventListener('scroll',update,{passive:true});
        const theme=new MutationObserver(update);theme.observe(document.documentElement,{attributes:true,attributeFilter:['class']});update();
        return()=>{resize.disconnect();theme.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',update)};
    });
</script>
<canvas class="section-particles" bind:this={canvas} aria-hidden="true"></canvas>
<style>.section-particles{display:block;width:100%;height:clamp(100px,18svh,180px);color:var(--primary);pointer-events:none}@media(prefers-reduced-motion:reduce){.section-particles{height:4rem;opacity:.25}}</style>
