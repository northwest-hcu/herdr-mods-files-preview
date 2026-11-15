// SPDX-License-Identifier: EPL-2.0
// Compatibility transformation for the generated Java Object prototype in elkjs 0.11.1.
export function patchElk(source) {
  const original = "_.toString=function(){return this.Ib()};";
  if (source.split(original).length !== 2) throw new Error("Unexpected elkjs source version.");
  source = source.replace(original,
    'Object.defineProperty(_,"toString",{value:function(){return this.Ib()},writable:true,configurable:true,enumerable:true});');
  const reply = /setTimeout\(function \(\) \{\s*_this2\.receive\(_this2, answer\);\s*\}, 0\);/g;
  if ([...source.matchAll(reply)].length !== 1) throw new Error("Unexpected elkjs worker version.");
  return source.replace(reply, 'Promise.resolve().then(function () { _this2.receive(_this2, answer); });');
}
