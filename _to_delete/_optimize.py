import os, sys, io
from PIL import Image
R = os.path.dirname(os.path.abspath(__file__))
SRC, NEW = os.path.join(R,"assets"), os.path.join(R,"media")
JOBS = [
 (SRC,"hero-porsche-963.png","hero-porsche-963",2200,78),
 (NEW,"Race Winner Graphic Design (1).png","win-brickyard-400-moss",1100,80),
 (NEW,"Race Winner Graphic Design.png","win-fis-r2-pocono-defabis",1100,80),
 (SRC,"win-lemans-majors.png","win-lemans-majors",900,80),
 (SRC,"Michael Cootmallo Cover.jpg","win-fss-champion-costello",900,80),
 (SRC,"win-daytona-24.png","win-daytona-24",900,80),
 (SRC,"trophy-sunset-p1.jpg","trophy-sunset-p1",900,80),
 (SRC,"win-indy500-2025.png","win-indy500-2025",900,80),
 (SRC,"trophy-hockenheim-alt.jpg","trophy-hockenheim-alt",900,80),
 (SRC,"win-grand-slam.jpg","win-grand-slam",900,80),
 (SRC,"win-double-podium.png","win-double-podium",900,80),
 (SRC,"win-fss-champions.jpg","win-fss-champions",900,80),
 (SRC,"trophy-fss-drivers-champ.jpg","trophy-fss-drivers-champ",900,80),
 (SRC,"face-michael-costello.png","face-michael-costello",560,80),
 (SRC,"face-titus-sherlock.webp","face-titus-sherlock",560,80),
 (SRC,"face-sam-mcdougall.jpg","face-sam-mcdougall",560,80),
 (SRC,"face-tanner-defabis.png","face-tanner-defabis",480,80),
 (SRC,"face-griffin-yellin.jpeg","face-griffin-yellin",480,80),
 (SRC,"face-jeremy-fairbairn.png","face-jeremy-fairbairn",480,80),
 (SRC,"face-tristan-moss.jpg","face-tristan-moss",480,80),
 (SRC,"face-max-taylor.jpg","face-max-taylor",480,80),
 (SRC,"face-devlin-defrancesco.webp","face-devlin-defrancesco",480,80),
 (SRC,"face-peter-dempsey.jpeg","face-peter-dempsey",480,80),
 (SRC,"face-evagoras-papasavvas.webp","face-evagoras-papasavvas",480,80),
 (SRC,"face-barrett-wolfe.webp","face-barrett-wolfe",480,80),
 (SRC,"face-drew-szuch.jpeg","face-drew-szuch",480,80),
 (SRC,"face-alex-berg.jpg","face-alex-berg",480,80),
 (SRC,"face-bryson-morris.png","face-bryson-morris",480,80),
 (SRC,"face-zach-fourie.webp","face-zach-fourie",480,80),
 (SRC,"face-tyke-durst.png","face-tyke-durst",480,80),
 (SRC,"media-imola-499p-02.png","media-imola-499p-02",1800,78),
 (SRC,"media-imola-499p-01.png","media-imola-499p-01",1800,78),
 (SRC,"media-april-2026.png","media-april-2026",1800,78),
 (SRC,"media-04.png","media-04",1800,78),
 (SRC,"media-03.png","media-03",1800,78),
 (SRC,"media-02.png","media-02",1800,78),
 (SRC,"media-01.jpg","media-01",1800,78),
 (SRC,"media-michael-portrait.jpg","media-michael-portrait",1800,78),
 (SRC,"sp-st-huberts.webp","sp-st-huberts",420,85),
 (SRC,"sp-rmhc.png","sp-rmhc",420,85),
 (SRC,"sp-hope4al.webp","sp-hope4al",420,85),
 (SRC,"sp-proguard.jpg","sp-proguard",420,85),
 (SRC,"sp-destination-athlete.jpeg","sp-destination-athlete",420,85),
 (SRC,"sp-eda-frames.jpg","sp-eda-frames",420,85),
 (SRC,"sp-rayne.jpg","sp-rayne",420,85),
 (SRC,"sp-iwis.webp","sp-iwis",420,85),
 (SRC,"sp-bell.jpeg","sp-bell",420,85),
 (SRC,"sp-ride-100.png","sp-ride-100",420,85),
 (SRC,"fis-s9-spotter-guide.png","fis-s9-spotter-guide",1600,80),
]
def encode(im, q):
    buf = io.BytesIO(); im.save(buf,"WEBP",quality=q,method=6); return buf.getvalue()

tin=tout=0; kept=[]
for d,fn,base,maxw,q in JOBS:
    src=os.path.join(d,fn)
    if not os.path.exists(src): print("MISSING:",src); sys.exit(1)
    im=Image.open(src)
    alpha = im.mode in ("RGBA","LA") or (im.mode=="P" and "transparency" in im.info)
    im=im.convert("RGBA" if alpha else "RGB")
    w0,h0=im.size
    if w0>maxw: im=im.resize((maxw,round(h0*maxw/w0)),Image.LANCZOS)
    data=encode(im,q)
    dst=os.path.join(SRC,base+".webp")
    a=os.path.getsize(src)
    # never replace a file with a bigger one (compare in memory: no temp files,
    # because this filesystem allows writes but not unlinks)
    if src==dst and a<=len(data):
        kept.append(base); tin+=a; tout+=a; continue
    with open(dst,"wb") as fh: fh.write(data)
    tin+=a; tout+=len(data)
print("kept originals (conversion was larger):", ", ".join(kept) or "none")

ra=Image.open(os.path.join(NEW,"Road_America_LMP2_Winners.jpg")).convert("RGB")
L,Rr,TOP=694,4403,1800
A=1363/784; w=Rr-L; h=int(w/A)
with open(os.path.join(SRC,"win-road-america-6h-lmp2.webp"),"wb") as fh:
    fh.write(encode(ra.crop((L,TOP,Rr,TOP+h)).resize((1400,int(1400/A)),Image.LANCZOS),82))

hero=Image.open(os.path.join(SRC,"hero-porsche-963.png")).convert("RGB")
tw,th=1200,630; s=max(tw/hero.width,th/hero.height)
hero=hero.resize((round(hero.width*s),round(hero.height*s)),Image.LANCZOS)
l,t=(hero.width-tw)//2,(hero.height-th)//2
b=io.BytesIO(); hero.crop((l,t,l+tw,t+th)).save(b,"JPEG",quality=80,optimize=True)
with open(os.path.join(SRC,"og-cover.jpg"),"wb") as fh: fh.write(b.getvalue())

print("TOTAL %.1f MB -> %.2f MB (%.1f%% smaller)"%(tin/1048576,tout/1048576,100*(1-tout/tin)))
