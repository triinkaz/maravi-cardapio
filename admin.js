(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const backend = window.MaraviBackend;
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => (cents / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  let token = null, expiryTimer, generation = 0, revision = null;
  let catalog = {products:[]}, original = '', busy = false, loginBusy = false;
  let editId = null, editorBaseline = '', editorGeneration = 0, uploadBusy = false;
  const imageNames = ['classic-nutella','double-chocolate','red-ninho','dark-cacau','kinder-classic','rabanada','selecao-maravi','aconchego','cenourito','ninho-frutas','maracuja-chocolate','quarteto-maravi','com-carinho','feliz-aniversario'];
  $('images').replaceChildren(...imageNames.map(name => {const option=document.createElement('option');option.value=`assets/${name}.webp`;return option;}));
  const changed = () => JSON.stringify(catalog) !== original;
  function message(text, error=false) {$('status').textContent=text;$('status').classList.toggle('error',error);$('status').hidden=!text;}
  function resetSession(text='') {
    generation++; editorGeneration++; token=null; clearTimeout(expiryTimer); busy=false; loginBusy=false; setUploadBusy(false);
    catalog={products:[]}; original=''; revision=null;
    if ($('editor').open) $('editor').close();
    $('product-form').reset(); $('flavors').replaceChildren(); $('products').replaceChildren();
    $('product-image-preview').removeAttribute('src'); $('product-image-preview').hidden=true;
    $('summary').replaceChildren(); $('workspace').hidden=true; $('login-section').hidden=false;
    $('password').value=''; $('login-button').disabled=!backend?.configured; message(text,!!text);
  }
  function setBusy(value) {
    busy=value;
    $('workspace').querySelectorAll('button').forEach(button => button.disabled=value);
    if(!value) $('publish').disabled=!changed();
  }
  function fail(error) {
    if(error.status===401 || error.status===403) {resetSession('Sua sessão expirou ou esta conta não tem permissão de administração. Entre novamente.');return;}
    if(error.status===409 || ['40001','conflict','revision_conflict'].includes(error.code)) {
      message('Outra sessão publicou alterações. Seu rascunho foi preservado. Copie o que precisar e use “Recarregar / descartar” antes de editar novamente.',true);return;
    }
    message(error.message || 'Não foi possível concluir. Verifique a conexão e tente novamente.',true);
  }
  function adopt(result) {
    if(!result || !result.catalog || !Array.isArray(result.catalog.products) || !Number.isSafeInteger(result.revision) || result.revision<1) throw new Error('O backend retornou um catálogo inválido.');
    window.MaraviCatalog.normalizeProducts(result.catalog.products);
    if(result.catalog.products.some(p=>p.custom&&!p.flavors.length))throw new Error('O backend retornou uma caixa sem cadastro de sabores.');
    catalog=clone(result.catalog); revision=result.revision; original=JSON.stringify(catalog); render();
  }
  function render() {
    const products=catalog.products;
    const active=products.filter(p=>p.active).length;
    $('summary').innerHTML=`<div><b>${products.length}</b>produtos cadastrados</div><div><b>${active}</b>ativos no cardápio</div><div><b>${products.filter(p=>p.stock===0).length}</b>sem estoque</div>`;
    $('draft-state').textContent=changed()?'Rascunho com alterações não publicadas':'Sem alterações pendentes';
    $('revision').textContent=`Versão ${revision} · estoque atualizado manualmente`;
    $('publish').disabled=busy||!changed();
    $('categories').replaceChildren(...[...new Set(products.map(p=>p.category))].map(category=>{const option=document.createElement('option');option.value=category;return option;}));
    const query=$('search').value.trim().toLocaleLowerCase('pt-BR'), filter=$('filter').value;
    const visible=products.filter(p=>(`${p.name} ${p.category}`.toLocaleLowerCase('pt-BR').includes(query))&&(filter==='all'||filter==='active'&&p.active||filter==='inactive'&&!p.active||filter==='empty'&&p.stock===0));
    $('products').innerHTML=visible.length?visible.map(p=>`<article class="product"><img src="${esc(p.image)}" alt="" loading="lazy"><div class="product-copy"><h3>${esc(p.name)}</h3><p>${esc(p.category)} · ${money(p.price_cents)}</p><div class="badges"><span class="badge ${p.active?'':'off'}">${p.active?'Ativo':'Inativo'}</span><span class="badge ${p.stock===0?'empty':'off'}">${p.stock===null?'Estoque sem limite':p.stock===0?'Esgotado':`${p.stock} em estoque`}</span>${p.custom?`<span class="badge off">Caixa de 4 · ${p.flavors.filter(f=>f.active).length} sabores ativos</span>`:''}</div></div><div class="product-actions"><button class="secondary" type="button" data-edit="${esc(p.id)}">Editar</button><button class="secondary" type="button" data-toggle="${esc(p.id)}">${p.active?'Inativar':'Ativar'}</button><button class="danger" type="button" data-delete="${esc(p.id)}">Excluir</button></div></article>`).join(''):'<p class="empty">Nenhum produto encontrado.</p>';
    setBusy(busy);
  }
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault(); if(loginBusy||!backend?.configured) return;
    loginBusy=true; $('login-button').disabled=true; message('Entrando…');
    const current=++generation; let session;
    try {
      session=await backend.login($('username').value.trim().toLowerCase(),$('password').value);
      $('password').value='';
      if(current!==generation)return;
      if(!session.accessToken||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now())throw new Error('A sessão recebida não é válida. Entre novamente.');
      token=session.accessToken;
      expiryTimer=setTimeout(()=>resetSession('Sua sessão expirou. Entre novamente. Alterações não publicadas foram descartadas.'),Math.min(session.expiresAt-Date.now(),2147483647));
      const result=await backend.getAdminCatalog(token);
      if(current!==generation)return;
      adopt(result); $('login-section').hidden=true; $('workspace').hidden=false; message('Sessão iniciada. As alterações só vão ao ar depois de publicadas.');
    } catch(error) {
      if(current!==generation)return;
      if(session?.accessToken) backend.logout(session.accessToken).catch(()=>{});
      resetSession(error.status===400||error.status===401?'Usuário ou senha inválidos. Tente novamente.':error.status===403?'Esta conta não está autorizada a administrar o cardápio.':error.message||'Não foi possível entrar. Verifique a conexão.');
    } finally {if(current===generation){loginBusy=false;$('login-button').disabled=!backend?.configured;}}
  });
  $('logout').addEventListener('click',async()=>{
    if(busy)return;
    if((changed()||$('editor').open)&&!confirm('Sair e descartar todas as alterações não publicadas?'))return;
    const oldToken=token; resetSession(); const current=generation; message('Você saiu do painel.');
    try{await backend.logout(oldToken);}catch{if(current!==generation)return;message('Você saiu deste navegador. Não foi possível confirmar a revogação no servidor; a sessão remota expirará automaticamente.',true);}
  });
  $('publish').addEventListener('click',async()=>{
    if(busy||!token||!changed())return;
    if(!confirm('Publicar este rascunho no cardápio? Produtos, preços, estoque e sabores serão atualizados para os clientes.'))return;
    const current=generation;setBusy(true);message('Publicando alterações…');
    try{const result=await backend.saveAdminCatalog(token,revision,clone(catalog));if(current!==generation)return;adopt(result);message('Alterações publicadas. O cardápio já usa esta versão.');}
    catch(error){if(current===generation)fail(error);}
    finally{if(current===generation)setBusy(false);}
  });
  $('reload').addEventListener('click',async()=>{
    if(busy||!token)return;
    if(changed()&&!confirm('Descartar este rascunho e carregar a última versão publicada?'))return;
    const current=generation;setBusy(true);message('Carregando versão publicada…');
    try{const result=await backend.getAdminCatalog(token);if(current!==generation)return;adopt(result);message('Última versão carregada.');}
    catch(error){if(current===generation)fail(error);}
    finally{if(current===generation)setBusy(false);}
  });
  $('search').addEventListener('input',render);$('filter').addEventListener('change',render);
  $('new-product').addEventListener('click',()=>{if(!busy&&token){if(catalog.products.length>=200){message('O catálogo aceita até 200 produtos.',true);return;}openEditor();}});
  $('products').addEventListener('click',event=>{
    if(busy||!token)return;
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.edit){openEditor(catalog.products.find(p=>p.id===button.dataset.edit));return;}
    if(button.dataset.toggle){const p=catalog.products.find(p=>p.id===button.dataset.toggle);if(p){p.active=!p.active;render();}return;}
    if(button.dataset.delete){const p=catalog.products.find(p=>p.id===button.dataset.delete);if(p&&confirm(`Excluir “${p.name}” do rascunho? A exclusão só será efetivada ao publicar. Para preservar o cadastro, use Inativar.`)){catalog.products=catalog.products.filter(x=>x.id!==p.id);render();}}
  });
  function addFlavor(flavor={name:'',active:true}) {
    if($('flavors').children.length>=20)return;
    const row=document.createElement('div');row.className='flavor-row';
    const label=document.createElement('label');label.className='flavor-name';label.textContent='Nome do sabor';
    const input=document.createElement('input');input.className='flavor-input';input.maxLength=100;input.required=true;input.value=flavor.name;label.append(input);
    const activeLabel=document.createElement('label');activeLabel.className='checkbox';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=flavor.active;activeLabel.append(checkbox,document.createTextNode('Ativo'));
    const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Remover';remove.addEventListener('click',()=>row.remove());
    row.append(label,activeLabel,remove);$('flavors').append(row);
  }
  function editorState(){return JSON.stringify({values:[...$('product-form').querySelectorAll('input,textarea,select')].map(input=>input.type==='checkbox'?input.checked:input.value)});}
  function setUploadBusy(value) {
    uploadBusy=value;
    $('product-photo').disabled=value;
    $('upload-image').disabled=value||!$('product-photo').files?.length||typeof backend?.uploadProductImage!=='function';
    $('product-image').disabled=value;
    $('apply-product').disabled=value;
  }
  function updateImagePreview() {
    const image=$('product-image').value.trim();
    const valid=window.MaraviCatalog.validProductImage(image);
    $('product-image-preview').hidden=!valid;
    if(valid) $('product-image-preview').src=image; else $('product-image-preview').removeAttribute('src');
  }
  function closeEditor(){if((uploadBusy||editorState()!==editorBaseline)&&!confirm('Descartar as alterações deste formulário? Uma foto já enviada não será usada no produto.'))return;editorGeneration++;setUploadBusy(false);$('editor').close();}
  function openEditor(product) {
    editorGeneration++;setUploadBusy(false);
    editId=product?.id||null;$('promotion-notice').hidden=editId!=='quarteto-maravi';$('product-form').reset();$('editor-error').hidden=true;
    $('editor-title').textContent=product?'Editar produto':'Novo produto';
    const p=product||{id:'',name:'',category:'',description:'',weight:'',price_cents:0,image:'assets/classic-nutella.webp',active:true,stock:null,custom:null,flavors:[]};
    for(const field of ['id','name','category','description','weight','image'])$('product-'+field).value=p[field];
    $('product-id').readOnly=!!product;$('product-price').value=p.price_cents?(p.price_cents/100).toFixed(2):'';
    $('product-stock').value=p.stock??'';$('product-active').checked=p.active;$('product-type').value=p.custom||'';
    $('flavors').replaceChildren();p.flavors.forEach(addFlavor);$('flavors-section').hidden=!p.custom;
    $('upload-status').textContent='JPG, PNG ou WebP, até 5 MB. A foto será otimizada antes do envio.';$('upload-status').classList.remove('error');setUploadBusy(false);updateImagePreview();
    editorBaseline=editorState();$('editor').showModal();$('product-name').focus();
  }
  $('product-image').addEventListener('input',updateImagePreview);
  $('product-photo').addEventListener('change',()=>{
    if(uploadBusy)return;
    const file=$('product-photo').files?.[0];
    $('upload-status').classList.remove('error');
    $('upload-status').textContent=file?'Foto selecionada. Clique em “Enviar foto” para carregá-la.':'JPG, PNG ou WebP, até 5 MB.';
    setUploadBusy(false);
  });
  $('upload-image').addEventListener('click',async()=>{
    const file=$('product-photo').files?.[0];
    if(uploadBusy||busy||!token||!file||!$('editor').open||typeof backend.uploadProductImage!=='function')return;
    const current=generation, currentEditor=editorGeneration;
    setUploadBusy(true);$('upload-status').classList.remove('error');$('upload-status').textContent='Otimizando e enviando foto…';
    try {
      const result=await backend.uploadProductImage(token,file);
      if(current!==generation||currentEditor!==editorGeneration||!$('editor').open)return;
      if(!window.MaraviCatalog.validProductImage(result?.image))throw new Error('O servidor retornou uma imagem inválida.');
      $('product-image').value=result.image;$('product-photo').value='';updateImagePreview();
      $('upload-status').textContent='Foto enviada. Aplique ao rascunho e publique quando terminar.';
    } catch(error) {
      if(current!==generation||currentEditor!==editorGeneration||!$('editor').open)return;
      if(error.status===401||error.status===403){fail(error);return;}
      $('upload-status').textContent=error.message||'Não foi possível enviar a foto. Tente novamente.';$('upload-status').classList.add('error');
    } finally {if(current===generation&&currentEditor===editorGeneration)setUploadBusy(false);}
  });
  $('close-editor').addEventListener('click',closeEditor);$('cancel-editor').addEventListener('click',closeEditor);
  $('editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
  $('add-flavor').addEventListener('click',()=>{addFlavor();$('flavors').lastElementChild?.querySelector('input').focus();});
  $('product-type').addEventListener('change',()=>{$('flavors-section').hidden=!$('product-type').value;$('flavors').querySelectorAll('input').forEach(input=>input.disabled=!$('product-type').value);if($('product-type').value&&!$('flavors').children.length)addFlavor();});
  $('product-form').addEventListener('submit',event=>{
    event.preventDefault();if(!token||busy||uploadBusy)return;
    const value=name=>$('product-'+name).value.trim();
    const custom=value('type')||null;
    const flavors=custom?[...$('flavors').children].map(row=>({name:row.querySelector('.flavor-input').value.trim(),active:row.querySelector('[type=checkbox]').checked})):[];
    const stock=value('stock')===''?null:Number(value('stock'));
    const price=Number(value('price')),cents=Math.round(price*100);
    const p={id:value('id'),name:value('name'),category:value('category'),description:value('description'),weight:value('weight'),image:value('image'),price_cents:cents,stock,active:$('product-active').checked,custom,flavors};
    let error='';
    if(!p.name||!p.category||!p.id)error='Preencha nome, identificador e categoria.';
    else if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id))error='O identificador deve conter apenas letras minúsculas, números e hífens entre palavras.';
    else if(catalog.products.some(x=>x.id===p.id&&x.id!==editId))error='Este identificador já existe. Escolha outro.';
    else if(!Number.isFinite(price)||cents<=0||cents>1000000||Math.abs(price*100-cents)>0.00001)error='Informe um preço positivo com até duas casas decimais.';
    else if(stock!==null&&(!Number.isInteger(stock)||stock<0||stock>99999))error='O estoque deve ser um número inteiro entre 0 e 99999, ou ficar vazio.';
    else if(!window.MaraviCatalog.validProductImage(p.image))error='Envie uma foto pelo painel ou escolha uma imagem válida já publicada.';
    else if(custom&&(!flavors.length||flavors.length>20||flavors.some(f=>!f.name||['__proto__','constructor','prototype'].includes(f.name.toLowerCase()))))error='Cadastre de 1 a 20 sabores com nomes válidos.';
    else if(new Set(flavors.map(f=>f.name.toLocaleLowerCase('pt-BR'))).size!==flavors.length)error='Cada sabor precisa ter um nome diferente.';
    if(error){$('editor-error').textContent=error;$('editor-error').hidden=false;return;}
    if(editId)catalog.products[catalog.products.findIndex(x=>x.id===editId)]=p;else catalog.products.push(p);
    $('editor').close();render();message('Produto aplicado ao rascunho. Publique quando terminar suas alterações.');
  });
  window.addEventListener('beforeunload',event=>{if(token&&(changed()||$('editor').open&&editorState()!==editorBaseline)){event.preventDefault();event.returnValue='';}});
  $('setup-notice').hidden=!!backend?.configured;
  $('login-form').querySelectorAll('input,button').forEach(input=>input.disabled=!backend?.configured);
})();
