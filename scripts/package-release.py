#!/usr/bin/env python3
"""Explicit original-source allowlist. No recursive dependency/cache packaging."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'cook-branch-output'
FILES=['.gitignore','.github/workflows/verify.yml','README.md','package.json','package-lock.json','index.html',
 'src/app.js','src/compiler.js','src/sample.js','src/limits.js','src/styles.css',
 'scripts/build.mjs','scripts/serve.mjs','scripts/package-release.py','scripts/fetch-oracles.py',
 'scripts/oracle-extension.mjs','scripts/oracle-matrix.mjs','scripts/oracle-profile.mjs','scripts/oracle_validate.py','scripts/oracle_support.py',
 'tests/build.test.mjs','tests/limits.test.mjs','tests/compiler.test.mjs','tests/oracle_mutations.py','tests/browser/run.mjs',
 'fixtures/orchard-bowl.cook','fixtures/oracle-lock.json','fixtures/oracle-manifest.json',
 'fixtures/expected/default-barley.cook','fixtures/expected/default-rice.cook','fixtures/expected/herb-barley.cook','fixtures/expected/herb-rice.cook',
 'docs/PROFILE.md','docs/VERIFICATION.md','docs/oracles.md','dist/cook-branch.html',
 'evidence/local-verification.json','evidence/matrix.evidence.json','evidence/profile.evidence.json','evidence/negative-control.evidence.json','evidence/provenance.evidence.json']
OPTIONAL=['evidence/independent-review.json','evidence/browser-report.json','evidence/visual-review.json','evidence/hosted-verification.json','evidence/chooser-lifecycle-investigation.json']
files=FILES+[p for p in OPTIONAL if (ROOT/p).is_file()]
for p in files:
 if not (ROOT/p).is_file():raise RuntimeError('Missing allowlisted input: '+p)
 if any(x in p for x in ['node_modules','.cache','__pycache__','artifacts/']):raise RuntimeError('Unsafe input')
OUT.mkdir(exist_ok=True)
manifest={'schema':'cookbranch.release-manifest/v1','reconstructed':'2026-10-06','files':[{'path':p,'bytes':(ROOT/p).stat().st_size,'sha256':hashlib.sha256((ROOT/p).read_bytes()).hexdigest()} for p in sorted(files)]}
(OUT/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
archive=OUT/'cook-branch-reconstructed-source.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(files):
  info=zipfile.ZipInfo('cook-branch/'+p,date_time=(2026,10,6,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,(ROOT/p).read_bytes())
 z.writestr('cook-branch/source-manifest.json',json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 assert len(z.namelist())==len(files)+1
 for entry in manifest['files']:assert hashlib.sha256(z.read('cook-branch/'+entry['path'])).hexdigest()==entry['sha256']
app=ROOT/'dist/cook-branch.html';(OUT/'cook-branch.html').write_bytes(app.read_bytes())
summary={'schema':'cookbranch.package-evidence/v1','status':'pass','reconstructed':'2026-10-06','originalSourceFiles':len(files),'sourceZipBytes':archive.stat().st_size,'sourceZipSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'offlineAppBytes':app.stat().st_size,'offlineAppSha256':hashlib.sha256(app.read_bytes()).hexdigest(),'testOnlyBinariesBundled':False,'testDependencyTreeBundled':False,'manifestEntriesVerified':len(files)}
(OUT/'package-verification.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
