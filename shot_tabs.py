import sys,asyncio
from playwright.async_api import async_playwright
base=sys.argv[1]
OUT='/workspace/groyperrewards/shots'
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for name,vp,mob in [('desktop',{'width':1366,'height':900},False),('mobile',{'width':390,'height':844},True)]:
      c=await b.new_context(viewport=vp,is_mobile=mob,device_scale_factor=2 if mob else 1)
      pg=await c.new_page(); errs=[]; pg.on('console',lambda m: m.type=='error' and errs.append(m.text)); pg.on('pageerror',lambda e: errs.append('PAGEERR '+str(e)))
      for tab,h,sel in [('rewards','#/',None),('wallet','#/w/CEhXie1UcSDezZBEQu4ZkzSphbr3kVSRcEpo2vkSLeY','#wallet'),('sol','#/leaders/sol',None),('forecast','#/leaders/sol/forecast','#fcSol'),('burns','#/burns',None),('locked','#/burns/locked','#locked')]:
        await pg.goto(base+h); await pg.wait_for_timeout(6000)
        if sel: await pg.evaluate(f"document.querySelector('{sel}').scrollIntoView({{block:'start'}})"); await pg.wait_for_timeout(800)
        on=await pg.evaluate("document.querySelector('.tab.on')?.textContent")
        txt=await pg.evaluate("(document.querySelector('[data-pane]:not(.hidden) .cards')||{}).innerText||''")
        print(name,tab,'tab:',on,'|',txt[:200].replace('\n',' / '))
        await pg.screenshot(path=f'{OUT}/{name}-{tab}.png',full_page=False)
        await pg.screenshot(path=f'{OUT}/{name}-{tab}-full.png',full_page=True)
      print(name,'errors',errs[:6])
      await c.close()
    await b.close()
asyncio.run(main())
