"""Sign a sanitized release; keep the private PEM key outside the repository.

Requires cryptography. Upload files/ first, then atomically publish manifest.json.
"""
from pathlib import Path
import argparse,base64,hashlib,json,re,shutil
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding,rsa

parser=argparse.ArgumentParser()
parser.add_argument('--payload',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--key',type=Path,required=True)
parser.add_argument('--version',required=True)
parser.add_argument('--sequence',type=int,required=True)
args=parser.parse_args()
assert args.sequence>0 and re.fullmatch(r'\d+\.\d+\.\d+',args.version)
root=args.payload.resolve(strict=True);out=args.output.resolve()
assert not out.is_relative_to(root)
assert not args.key.resolve().is_relative_to(root),'Signing key must not be in payload'
key=serialization.load_pem_private_key(args.key.read_bytes(),password=None)
assert isinstance(key,rsa.RSAPrivateKey) and key.key_size>=3072
trust=(Path(__file__).resolve().parent.parent/'client/Launcher/ReleaseTrust.cs').read_text()
modulus=re.search(r'<Modulus>(.*?)</Modulus>',trust).group(1)
assert int.from_bytes(base64.b64decode(modulus),'big')==key.public_key().public_numbers().n,'Wrong signing key'
files=[];(out/'files').mkdir(parents=True,exist_ok=True)
for source in sorted(root.rglob('*')):
    if not source.is_file():continue
    assert not source.is_symlink()
    rel=source.relative_to(root).as_posix()
    assert not any(x in ('..','secrets','data','__pycache__') for x in source.relative_to(root).parts)
    assert not re.search(r'(selection|profile)\.json$|(?:^|/)(?:playstyle|lan-status|lan-start|lan-cancel|lan-return|loot-hint|lan-lobby-command|lan-lobby-result)\.json$|(?:^|/)(?:lan-config-|pause-)|\.(?:log|tmp|lnk)$',rel,re.I),rel
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    target=out/'files'/digest
    if not target.exists():shutil.copyfile(source,target)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==digest
    files.append(dict(path=rel,size=source.stat().st_size,sha256=digest))
payload=json.dumps(dict(schema=1,version=args.version,sequence=args.sequence,files=files),ensure_ascii=False,separators=(',',':')).encode()
signature=key.sign(payload,padding.PKCS1v15(),hashes.SHA256())
envelope=json.dumps(dict(payload=base64.b64encode(payload).decode(),signature=base64.b64encode(signature).decode()),separators=(',',':')).encode()
assert len(envelope)<8*1024*1024
(out/'manifest.json').write_bytes(envelope)
print(json.dumps(dict(version=args.version,files=len(files),payloadBytes=sum(f['size'] for f in files),manifestBytes=len(envelope))))
