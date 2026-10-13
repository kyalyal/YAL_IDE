import assetFactory from './skills/builtin/yal-asset-factory.md?raw'

// The skill is the single source for project rules and the catalog entry format.
export const ASSET_RULES = assetFactory.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
const catalog = ASSET_RULES.match(/```markdown\r?\n([\s\S]*?)\r?\n```/)
if (!catalog) throw new Error('Asset factory catalog format is missing')
export const ASSET_CATALOG_FORMAT = catalog[1].replace(/\r\n/g, '\n')
