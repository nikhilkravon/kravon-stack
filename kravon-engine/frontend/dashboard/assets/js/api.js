'use strict';

/**
 * Api — thin fetch wrapper
 *
 * Automatically injects the Authorization header from Auth.getToken().
 * On 401, refreshes once and retries before throwing.
 * path is always the full path, e.g. /v1/restaurants/spice-garden/orders
 */
const Api = (() => {
  const BASE = () => window.KRAVON_API_BASE || 'http://localhost:3000';

  async function _req(method, path, body, retry = true) {
    let token;
    try { token = await Auth.getToken(); }
    catch { window.App?.sessionExpired(); throw new Error('Session expired'); }

    const init = {
      method,
      credentials: 'include',   // send HttpOnly RT cookie on every request
      headers: { 'Authorization': `Bearer ${token}` },
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await fetch(`${BASE()}${path}`, init);

    if (res.status === 401 && retry) {
      try { await Auth.refresh(); }
      catch { window.App?.sessionExpired(); throw new Error('Session expired'); }
      return _req(method, path, body, false);
    }

    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  }

  // slug-scoped helpers — automatically prepend /v1/restaurants/:slug
  function _slug() { return Auth.state().slug; }
  function _r(path) { return `/v1/restaurants/${_slug()}${path}`; }

  async function _uploadFile(endpoint, file) {
    let token;
    try { token = await Auth.getToken(); }
    catch { window.App?.sessionExpired(); throw new Error('Session expired'); }
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE()}${endpoint}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data.url;
  }

  return {
    // Raw (full path)
    get:   (path)        => _req('GET',    path),
    post:  (path, body)  => _req('POST',   path, body),
    put:   (path, body)  => _req('PUT',    path, body),
    patch: (path, body)  => _req('PATCH',  path, body),
    del:   (path)        => _req('DELETE', path),

    // Restaurant-scoped (path is appended after /v1/restaurants/:slug)
    rGet:   (path)       => _req('GET',    _r(path)),
    rPost:  (path, body) => _req('POST',   _r(path), body),
    rPut:   (path, body) => _req('PUT',    _r(path), body),
    rPatch: (path, body) => _req('PATCH',  _r(path), body),
    rDel:   (path)       => _req('DELETE', _r(path)),

    // File upload
    rUploadImage:     (file) => _uploadFile(_r('/presence/images'), file),
    rUploadMenuImage: (file) => _uploadFile(_r('/menu/images'), file),
  };
})();
