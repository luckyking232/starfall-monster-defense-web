/** Presentation wording only: does not admit any additional frame or font. */
export function phaseCopy({phase,worldVisible,hasNativeFont}, titles){
 if(phase==='battle'&&worldVisible)return '原版 Lua 规则 · 原素材画面重建';
 if(phase==='upgrade'&&hasNativeFont)return '原版升级选择 · 原字形预览';
 return titles[phase]??phase;
}
export function exactFontHoldCopy(held){
 if(!held.length)return '';
 if(held.every(x=>x.reason==='authored_transition_present'))
  return '入场动画尚未结束；结束后显示已支持的文字。';
 return '仍有 '+held.length+' 项文字未绘。';
}
