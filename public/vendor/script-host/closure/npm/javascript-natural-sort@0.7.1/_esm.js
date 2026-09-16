/**
 * Bundled by jsDelivr using Rollup v2.79.2 and Terser v5.39.0.
 * Original file: /npm/javascript-natural-sort@0.7.1/naturalSort.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
var e=function e(a,r){var t,n,p=/(^([+\-]?(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+\-]?\d+)?)?$|^0x[0-9a-f]+$|\d+)/gi,i=/(^[ ]*|[ ]*$)/g,l=/(^([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?|^\d{1,4}[\/\-]\d{1,4}[\/\-]\d{1,4}|^\w+, \w+ \d+, \d{4})/,c=/^0x[0-9a-f]+$/i,s=/^0/,f=function(a){return e.insensitive&&(""+a).toLowerCase()||""+a},d=f(a).replace(i,"")||"",u=f(r).replace(i,"")||"",h=d.replace(p,"\0$1\0").replace(/\0$/,"").replace(/^\0/,"").split("\0"),o=u.replace(p,"\0$1\0").replace(/\0$/,"").replace(/^\0/,"").split("\0"),w=parseInt(d.match(c),16)||1!==h.length&&d.match(l)&&Date.parse(d),$=parseInt(u.match(c),16)||w&&u.match(l)&&Date.parse(u)||null;if($){if(w<$)return-1;if(w>$)return 1}for(var m=0,N=Math.max(h.length,o.length);m<N;m++){if(t=!(h[m]||"").match(s)&&parseFloat(h[m])||h[m]||0,n=!(o[m]||"").match(s)&&parseFloat(o[m])||o[m]||0,isNaN(t)!==isNaN(n))return isNaN(t)?1:-1;if(typeof t!=typeof n&&(t+="",n+=""),t<n)return-1;if(t>n)return 1}return 0};export{e as default};
//# sourceMappingURL=/sm/ce5d980c2a030ad55f0e027bc7f6e377f6b38ec23379df0adfaf3dfdbc1f2a6b.map