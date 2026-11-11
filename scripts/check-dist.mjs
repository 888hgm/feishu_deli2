import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
const root = resolve('dist');
if (!existsSync(resolve(root, 'index.html'))) throw new Error('dist 根目录缺少 index.html');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
if (!assets.length) throw new Error('没有构建资源');
for (const asset of assets) {
  if (!asset.startsWith('./')) throw new Error(`资源必须使用相对路径：${asset}`);
  const file = resolve(root, asset);
  if (relative(root, file).startsWith(`..${sep}`) || !existsSync(file)) throw new Error(`资源不可用：${asset}`);
}
console.log(`dist 检查通过：index.html 与 ${assets.length} 个相对资源入口`);
