// Homoglyph maps from github.com/5CORNERS/GlyphZip
const GROUP1 = { 'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C','Т':'T','Х':'X','а':'a','е':'e','ё':'e','о':'o','р':'p','с':'c','у':'y','х':'x','—':'-' }
const GROUP2 = { 'т':'m','п':'n','и':'u','д':'g' }
const GROUP3 = { 'б':'6','З':'3','У':'Y','Д':'D','к':'k','г':'r','т':'t','ш':'w','Ш':'W','ч':'4','ь':'b' }

export function applyGlyphZip(text, groups = ['g1']) {
  const useG2 = groups.includes('g2')
  const useG3 = groups.includes('g3')
  const useG1 = groups.includes('g1')
  return [...text].map(ch => {
    if (useG2 && GROUP2[ch]) return GROUP2[ch]
    if (useG3 && GROUP3[ch]) return GROUP3[ch]
    if (useG1 && GROUP1[ch]) return GROUP1[ch]
    return ch
  }).join('')
}
