import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pr = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')).pull_request;
assert.equal(pr.head.repo.full_name,pr.base.repo.full_name,'请从本仓 test 晋级');
assert.equal(pr.head.ref,'test','请从 test 晋级');
const tree = ref => execFileSync('git',['rev-parse',ref + '^{tree}'],{encoding:'utf8'}).trim();
assert.equal(tree('HEAD'),tree(pr.head.sha),'候选合并树与已测 test 不同，请先同步 test');
const versionUrl = 'https://luckyking232.github.io/starfall-monster-defense-web/play/version.json';
const version = await fetch(versionUrl + '?head=' + pr.head.sha,{cache:'no-store'});
assert.ok(version.ok,'测试站版本不可用');
const published = await version.json();
assert.equal(published.commit,pr.head.sha,'测试站尚未部署此提交');
assert.equal(published.tree,tree(pr.head.sha),'测试站资源版本与候选不一致');
const response = await fetch('https://api.github.com/repos/' + pr.base.repo.full_name + '/commits/' + pr.head.sha + '/status',{
  headers:{Authorization:'Bearer ' + process.env.GITHUB_TOKEN, 'User-Agent':'monster-defense-promotion'}
});
assert.ok(response.ok,'无法读取测试验收记录');
const {statuses} = await response.json();
assert.equal(statuses.find(s => s.context === 'test-device-acceptance')?.state,'success','本次 test 提交缺少真机试玩通过记录');
