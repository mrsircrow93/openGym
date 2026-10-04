#!/usr/bin/env python3
"""Marketing frames for the store listing: headline on top, the raw app screenshot below,
on the app's dark background. Output is exactly 1290x2796 (iPhone 6.7") and 1284x2778 (6.5").

usage: store-frames.py <shots-dir> <out-dir> <lang es|en>
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

shots, out, lang = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else 'es')
os.makedirs(out, exist_ok=True)
CAPTIONS = {
    'es': [('home', 'Tu día, de un vistazo', 'Entrenamiento, comida, pasos y peso en una pantalla'),
           ('plan', 'Rutinas que se adaptan a tu semana', 'Generadas para ti o importadas de tu entrenador'),
           ('nutrition', 'Foto a tu comida, macros al instante', 'Calorías, proteína, carbohidratos y grasa'),
           ('stats', 'Mide lo que el espejo esconde', 'Fotos de progreso mensuales con nota del coach'),
           ('badges', 'Rachas e insignias que motivan', 'Pequeñas metas, grandes cambios'),
           ('history', 'Cada entrenamiento cuenta', 'Historial, récords y progresión de cargas')],
    'en': [('home', 'Your day at a glance', 'Training, meals, steps and weight on one screen'),
           ('plan', 'Routines that fit your week', 'Generated for you or imported from your trainer'),
           ('nutrition', 'Snap your meal, macros instantly', 'Calories, protein, carbs and fat'),
           ('stats', 'Measure what the mirror hides', 'Monthly progress photos with a coach note'),
           ('badges', 'Streaks and badges that motivate', 'Small goals, big changes'),
           ('history', 'Every workout counts', 'History, records and load progression')],
}[lang]
BG, FG, MUTED, ACC = (18, 18, 18), (245, 245, 245), (160, 165, 160), (200, 255, 60)

def font(size, bold=False):
    for p in (['/System/Library/Fonts/SFNS.ttf'] if not bold else ['/System/Library/Fonts/SFNSDisplay-Bold.otf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/SFNS.ttf']):
        try: return ImageFont.truetype(p, size)
        except Exception: pass
    return ImageFont.load_default()

def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def rounded(img, r):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius=r, fill=255)
    outimg = Image.new('RGBA', img.size); outimg.paste(img, (0, 0), mask); return outimg

for size in [(1290, 2796), (1284, 2778)]:
    W, H = size
    for i, (name, title, sub) in enumerate(CAPTIONS, 1):
        src = os.path.join(shots, name + '.png')
        if not os.path.exists(src): continue
        canvas = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(canvas)
        tf, sf = font(78, True), font(40)
        y = 150
        for line in wrap(d, title, tf, W - 160): d.text((W // 2, y), line, fill=FG, font=tf, anchor='mt'); y += 92
        y += 10
        for line in wrap(d, sub, sf, W - 200): d.text((W // 2, y), line, fill=MUTED, font=sf, anchor='mt'); y += 52
        y += 50
        shot = Image.open(src).convert('RGB')
        scale = (H - y - 0) / shot.height * 1.0
        tw = int(shot.width * scale); th = int(shot.height * scale)
        if tw > W - 140: scale = (W - 140) / shot.width; tw = int(shot.width * scale); th = int(shot.height * scale)
        shot = shot.resize((tw, th), Image.LANCZOS)
        shot = rounded(shot, 70)
        x = (W - tw) // 2
        # subtle bezel
        d.rounded_rectangle((x - 14, y - 14, x + tw + 14, y + th + 14), radius=84, fill=(38, 40, 36))
        canvas.paste(shot, (x, y), shot)
        canvas = canvas.crop((0, 0, W, H))
        canvas.save(os.path.join(out, f'{W}x{H}-{i}-{name}.png'))
print('ok', out)
