"""Register host in current user's Chrome and Firefox; Windows, Python 3."""
import json, os, sys, winreg
from pathlib import Path
root=Path(__file__).resolve().parent
name='com.gamelibraryguard.bridge'
chrome_id=input('Chrome extension ID (from chrome://extensions; blank to skip): ').strip()
firefox_id='game-library-guard@local.invalid'
launch=root/'reader'/'bin'/'Release'/'net10.0'/'PlayniteReader.exe'
if not launch.is_file():
    raise SystemExit('Build the native executable first: dotnet build native/reader/PlayniteReader.csproj -c Release')
def register(browser,manifest):
    path=root/('host_'+browser+'.json');path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    key='Software\\'+ ('Google\\Chrome' if browser=='chrome' else 'Mozilla')+'\\NativeMessagingHosts\\'+name
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,key) as k:winreg.SetValueEx(k,'',0,winreg.REG_SZ,str(path))
if chrome_id:
    if not chrome_id.islower() or len(chrome_id)!=32 or not all('a'<=c<='p' for c in chrome_id):raise SystemExit('Invalid Chrome extension ID')
    register('chrome',{'name':name,'description':'Game Library Guard read-only Playnite bridge','path':str(launch),'type':'stdio','allowed_origins':['chrome-extension://'+chrome_id+'/']})
register('firefox',{'name':name,'description':'Game Library Guard read-only Playnite bridge','path':str(launch),'type':'stdio','allowed_extensions':[firefox_id]})
print('Host registered. Restart browsers. Keep this directory in place.')
