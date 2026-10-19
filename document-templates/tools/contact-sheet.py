import sys,glob,subprocess,os
from PIL import Image
pdf,out=sys.argv[1],sys.argv[2]
d=out+'_pages'; os.makedirs(d,exist_ok=True)
subprocess.run(['pdftoppm','-r','70','-png',pdf,d+'/p'])
fs=sorted(glob.glob(d+'/p-*.png')); ims=[Image.open(f) for f in fs]
w,h=ims[0].size; n=len(ims); r=(n+2)//3
s=Image.new('RGB',(w*3+40,(h+10)*r+10),'#888')
for k,im in enumerate(ims): s.paste(im,(10+(k%3)*(w+10),10+(k//3)*(h+10)))
s.save(out); print(n,'pages')
