"""Authored concept-matching sedan atlas, with one 256px cell per surface role."""
import math

SIZE=1024
TILES=['paint','windshield','rear-glass','side-glass','trim','tire','hub','grille',
       'lamp','amber','tail','plate','doors','hood','trunk','roof']
COLORS={'paint':'#ffc125','glass':'#202c49','trim':'#747985',
        'tire':'#232733','hub':'#c5c8ce','grille':'#151c26',
        'lamp':'#fff1bd','amber':'#dfa01a','tail':'#d9212f'}

def rgb(value):
    return tuple(int(value[i:i+2],16)/255 for i in (1,3,5))

PALETTE={name:rgb(value) for name,value in COLORS.items()}

def shade(tile,u,v):
    # Author in the usable UV region. Padding must not shrink painted window
    # frames, move door seams, or push panel borders outside the sampled area.
    u,v=(u-.03125)/.9375,(v-.03125)/.9375
    color=PALETTE.get(tile,PALETTE['paint'])
    factor=1.0
    edge=min(u,1-u,v,1-v)
    if tile in ['windshield','rear-glass','side-glass']:
        # These trapezoids use affine world-space UVs; the middle pillar stays
        # straight across the triangulated cabin, even under perspective.
        left=.035+(.138 if tile=='side-glass' else .081)*v
        right=.965-(.197 if tile=='side-glass' else .081)*v
        inside=left<u<right and .055<v<.945
        pillar=tile=='side-glass' and abs(u-.473)<.014
        if inside:
            color=rgb('#30394b') if pillar else PALETTE['glass']
            factor=.90+.18*v
            if pillar and abs(u-.473)<.003:
                color=rgb('#78808c')
            elif not pillar:
                border=min(u-left,right-u,v-.055,.945-v)
                if border<.010:
                    color=rgb('#111c2c')
                elif border<.016:
                    color=rgb('#455166')
    elif tile=='doors':
        # Continuous world-space projection over 4m length and .86m height.
        color=PALETTE['paint'] if v>.37 else PALETTE['trim']
        factor=.94+.06*v
        if abs(v-.37)<.005:
            color=rgb('#e5d39c')
        elif abs(v-.36)<.005:
            color=rgb('#555b68')
        seams=[.2675,.535,.775]
        distance=min(abs(u-s) for s in seams)
        if .04<v<.985 and distance<.004:
            color=rgb('#493218') if v>.37 else rgb('#373e4b')
        elif .04<v<.985 and any(.004<u-s<.007 for s in seams):
            color=rgb('#ffdf72') if v>.37 else rgb('#969ca8')
        # Raised golden rectangular handles, dark inset and bright upper rim.
        for center in [.37,.6575]:
            dx,dy=abs(u-center),abs(v-.805)
            if dx<.024 and dy<.030:
                color=rgb('#ad781b')
                if dx<.020 and dy<.020:
                    color=rgb('#e7ac2d')
                if dx<.021 and .012<v-.805<.022:
                    color=rgb('#ffe594')
                if dx<.019 and -.023<v-.805<-.015:
                    color=rgb('#78551b')
        if .04<v<.055:
            color=rgb('#434b59')
    elif tile in ['hood','trunk','roof']:
        factor=.99+.01*v
        # Panel outlines are INSIDE the padded UV region, unlike the old atlas.
        boundary=min(u-.065,.935-u,v-.065,.935-v)
        if -.004<boundary<.004:
            color=rgb('#b8831b')
        elif .004<boundary<.010:
            color=rgb('#ffe17c')
        if tile=='hood' and .09<v<.94:
            if any(abs(u-s)<.004 for s in [.23,.77]):
                color=rgb('#d79b21')
            elif any(.004<u-s<.011 for s in [.23,.77]):
                color=rgb('#ffdc65')
    elif tile=='trim':
        factor=.83+.30*v
        if .035<edge<.052:
            factor*=.75
        if .052<edge<.063:
            factor*=1.15
        if any(abs(u-s)<.004 for s in [.23,.77]):
            factor*=.8
    elif tile=='tire':
        factor=.88+.14*v
        if .10<v<.90 and any(abs(u-s)<.006 for s in [.10,.18,.82,.90]):
            factor*=.7
    elif tile=='hub':
        r=math.hypot(u-.5,v-.5)
        factor=.90+.18*v
        if r>.47:
            color=rgb('#454d5e')
        elif r>.435:
            color=rgb('#e6e8ed')
        elif r>.405:
            color=rgb('#7d8595')
        elif r>.385:
            color=rgb('#eff0f3')
    elif tile=='grille':
        color=PALETTE['grille']
        for bar in [.22,.50,.78]:
            if abs(v-bar)<.027:
                color=rgb('#69717e')
            elif -.043<v-bar<-.027:
                color=rgb('#080d16')
    elif tile=='plate':
        color=rgb('#1e2735')
        if edge<.055:
            color=rgb('#636c7b')
        elif edge<.080:
            color=rgb('#101927')
        if any(math.hypot(u-s,v-.5)<.014 for s in [.10,.90]):
            color=rgb('#87909f')
    elif tile in ['lamp','tail']:
        color=PALETTE[tile]
        if tile=='tail':
            if edge<.07:
                color=rgb('#681821')
            elif edge<.095:
                color=rgb('#ef5260')
            elif .12<u<.40 and .18<v<.48:
                color=rgb('#ff7880')
            elif .13<u<.41 and .48<v<.51:
                color=rgb('#ff9a9f')
        else:
            if edge<.045:
                color=rgb('#b37e1b')
            elif edge<.07:
                color=rgb('#fff3c8')
        factor=.92+.08*v
        if edge>.10 and int(u*28)%4==0:
            factor*=.94
    return tuple(min(1,max(0,c*factor)) for c in color)+(1,)
