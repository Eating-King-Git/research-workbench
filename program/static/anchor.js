(function(root){
  'use strict';
  function locate(text,a){
    const quote=a.quote||'';if(!quote)return null;
    const context=i=>(!a.prefix||text.slice(Math.max(0,i-a.prefix.length),i)===a.prefix)&&(!a.suffix||text.slice(i+quote.length,i+quote.length+a.suffix.length)===a.suffix);
    if(text.slice(a.start,a.end)===quote&&context(a.start))return {start:a.start,end:a.end};
    const hits=[];let i=text.indexOf(quote);
    while(i!==-1){if(context(i))hits.push(i);if(hits.length>1)return null;i=text.indexOf(quote,i+1);}
    return hits.length===1?{start:hits[0],end:hits[0]+quote.length}:null;
  }
  root.QuoteAnchor={locate};
  if(typeof module==='object'&&module.exports)module.exports={locate};
})(typeof window==='undefined'?globalThis:window);
