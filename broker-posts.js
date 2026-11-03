(function (global) {
  'use strict';
  if (global.ibrBrokerPosts) return;

  var authorCache = new Map();
  var FALLBACK_PHOTO = '/assets/images/dark-hamlet.png';

  function asDate(value) {
    if (!value) return null;
    var date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    return date && !isNaN(date.getTime()) ? date : null;
  }

  function timeLabel(value) {
    var date = asDate(value);
    if (!date) return 'Just posted';
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (error) {
      return date.toLocaleString();
    }
  }

  function sortNewest(posts) {
    return (posts || []).slice().sort(function (a, b) {
      var aDate = asDate(a.data && a.data.createdAt);
      var bDate = asDate(b.data && b.data.createdAt);
      return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
    });
  }

  function getAuthorProfile(uid) {
    if (!uid) return Promise.resolve({ name: 'IBR Member', photo: FALLBACK_PHOTO });
    if (authorCache.has(uid)) return authorCache.get(uid);
    var promise = (async function () {
      try {
        if (!global.ibrProfileService) throw new Error('Profile service unavailable.');
        var result = await global.ibrProfileService.getProfile(uid);
        var data = result && result.exists ? (result.data || {}) : {};
        var name = [data.firstName, data.lastName].filter(function (part) {
          return typeof part === 'string' && part.trim();
        }).map(function (part) { return part.trim(); }).join(' ')
          || (typeof data.displayName === 'string' ? data.displayName.trim() : '')
          || 'IBR Member';
        var photo = (typeof data.imageDataUrl === 'string' && data.imageDataUrl.trim())
          || (typeof data.photoURL === 'string' && data.photoURL.trim())
          || (typeof data.photoUrl === 'string' && data.photoUrl.trim())
          || FALLBACK_PHOTO;
        var email = typeof data.email === 'string' ? data.email.trim() : '';
        return { name: name, photo: photo, email: email, username: typeof data.username === 'string' ? data.username.trim().toLowerCase() : '' };
      } catch (error) {
        return { name: 'IBR Member', photo: FALLBACK_PHOTO, email: '' };
      }
    })();
    authorCache.set(uid, promise);
    return promise;
  }

  function validUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      var parsed = new URL(value, global.location.origin);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
    } catch (error) {
      return '';
    }
  }

  function renderAttachments(container, attachments) {
    if (!Array.isArray(attachments)) return;
    attachments.forEach(function (file) {
      if (!file || typeof file !== 'object') return;
      var url = validUrl(file.url);
      if (!url) return;
      var name = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : 'Shared attachment';
      var type = typeof file.contentType === 'string' ? file.contentType.toLowerCase() : '';
      var isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
      var isImage = type.indexOf('image/') === 0 || /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(name);
      var item = document.createElement('figure');
      item.className = 'post-attachment' + (isPdf ? ' post-attachment-pdf' : '');
      if (isPdf) {
        var title = document.createElement('figcaption');
        title.className = 'attachment-title';
        title.textContent = '📄 ' + name;
        item.appendChild(title);
        var frame = document.createElement('iframe');
        frame.className = 'pdf-preview';
        frame.src = url + '#view=FitH';
        frame.title = 'PDF preview: ' + name;
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer';
        item.appendChild(frame);
        var open = document.createElement('a');
        open.className = 'attachment-open-link';
        open.href = url;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = 'Open PDF in a new tab';
        item.appendChild(open);
      } else if (isImage) {
        var link = document.createElement('a');
        link.className = 'image-preview-link';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', 'Open image: ' + name);
        var image = document.createElement('img');
        image.className = 'post-image-preview';
        image.src = url;
        image.alt = name;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        link.appendChild(image);
        item.appendChild(link);
        var caption = document.createElement('figcaption');
        caption.className = 'attachment-title';
        caption.textContent = name;
        item.appendChild(caption);
      } else {
        var fallback = document.createElement('a');
        fallback.href = url;
        fallback.target = '_blank';
        fallback.rel = 'noopener noreferrer';
        fallback.textContent = '📎 ' + name;
        item.appendChild(fallback);
      }
      container.appendChild(item);
    });
  }

  // Render plain post text while turning HTTP(S) URLs into safe, clickable links.
  // Build nodes rather than injecting HTML so user-authored content cannot execute markup.
  function appendLinkedText(container, text) {
    var value = typeof text === 'string' ? text : '';
    var urlPattern = /((https?:\/\/|www\.)[^\s<>"']+)/gi;
    var lastIndex = 0;
    var match;
    while ((match = urlPattern.exec(value)) !== null) {
      if (match.index > lastIndex) container.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      var rawUrl = match[0];
      var trailing = '';
      while (/[.,!?;:)]$/.test(rawUrl)) {
        trailing = rawUrl.slice(-1) + trailing;
        rawUrl = rawUrl.slice(0, -1);
      }
      var href = validUrl(/^www\./i.test(rawUrl) ? 'https://' + rawUrl : rawUrl);
      if (href) {
        var link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'post-body-link';
        link.textContent = rawUrl;
        container.appendChild(link);
      } else {
        container.appendChild(document.createTextNode(rawUrl));
      }
      if (trailing) container.appendChild(document.createTextNode(trailing));
      lastIndex = urlPattern.lastIndex;
    }
    if (lastIndex < value.length) container.appendChild(document.createTextNode(value.slice(lastIndex)));
  }

  function appendUrlPreview(container, text) {
    var value = typeof text === 'string' ? text : '';
    var match = value.match(/(?:https?:\/\/|www\.)[^\s<>"']+/i);
    if (!match) return;
    var raw = match[0].replace(/[.,!?;:)}\]]+$/, '');
    var url = validUrl(/^www\./i.test(raw) ? 'https://' + raw : raw);
    if (!url) return;

    var card = document.createElement('a');
    card.className = 'post-url-preview';
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('aria-label', 'Open link preview in a new tab');
    var image = document.createElement('img');
    image.className = 'post-url-preview-image';
    image.alt = '';
    image.loading = 'lazy';
    image.hidden = true;
    var content = document.createElement('div');
    content.className = 'post-url-preview-content';
    var domain = document.createElement('div');
    domain.className = 'post-url-preview-domain';
    try { domain.textContent = new URL(url).hostname.replace(/^www\./i, ''); }
    catch (error) { domain.textContent = url; }
    var title = document.createElement('div');
    title.className = 'post-url-preview-title';
    title.textContent = 'Loading link preview…';
    var description = document.createElement('div');
    description.className = 'post-url-preview-description';
    description.textContent = url;
    content.append(domain, title, description);
    card.append(image, content);
    container.appendChild(card);

    // Microlink extracts Open Graph, Twitter Card and page metadata without
    // requiring the destination website to allow direct browser scraping.
    var endpoint = 'https://api.microlink.io/?url=' + encodeURIComponent(url) + '&meta=true&screenshot=false&video=false&audio=false';
    fetch(endpoint, { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('Preview service returned ' + response.status);
        return response.json();
      })
      .then(function (result) {
        var data = result && result.data ? result.data : {};
        if (!data.title && !data.description && !(data.image && data.image.url)) {
          title.textContent = 'Open link';
          description.textContent = url;
          return;
        }
        title.textContent = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : url;
        description.textContent = typeof data.description === 'string' ? data.description.trim() : '';
        if (data.image && typeof data.image.url === 'string' && validUrl(data.image.url)) {
          image.src = data.image.url;
          image.hidden = false;
          image.onerror = function () { image.hidden = true; };
        }
        if (typeof data.publisher === 'string' && data.publisher.trim()) {
          domain.textContent = data.publisher.trim() + ' · ' + domain.textContent;
        }
      })
      .catch(function () {
        title.textContent = 'Open link';
        description.textContent = url;
      });
  }

  function appendFormattedBody(container, html, plainText) {
    if (typeof html !== 'string' || !html.trim()) { appendLinkedText(container, plainText); return; }
    var parsed = new DOMParser().parseFromString(html, 'text/html');
    var allowed = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', BR: 'br' };
    function copyNode(source, target) {
      if (source.nodeType === Node.TEXT_NODE) { appendLinkedText(target, source.nodeValue || ''); return; }
      if (source.nodeType !== Node.ELEMENT_NODE) return;
      var tag = allowed[source.tagName];
      if (!tag) { Array.prototype.forEach.call(source.childNodes, function (child) { copyNode(child, target); }); return; }
      var safe = document.createElement(tag); target.appendChild(safe);
      if (tag !== 'br') Array.prototype.forEach.call(source.childNodes, function (child) { copyNode(child, safe); });
    }
    Array.prototype.forEach.call(parsed.body.childNodes, function (child) { copyNode(child, container); });
  }

  function createPostCard(post, options) {
    options = options || {};
    var data = post && post.data ? post.data : {};
    var article = document.createElement('article');
    article.className = 'post-card';
    article.dataset.postId = post.id || '';
    article.dataset.ownerUid = data.ownerUid || '';

    var header = document.createElement('div');
    header.className = 'post-author-row';
    var avatar = document.createElement('img');
    avatar.className = 'post-author-avatar';
    avatar.src = FALLBACK_PHOTO;
    avatar.alt = 'Member profile photo';
    avatar.loading = 'lazy';
    avatar.onerror = function () { avatar.onerror = null; avatar.src = FALLBACK_PHOTO; };

    var authorMeta = document.createElement('div');
    authorMeta.className = 'post-author-meta';
    var authorLink = document.createElement('a');
    authorLink.className = 'post-author-name';
    authorLink.href = '/profile.html?uid=' + encodeURIComponent(data.ownerUid || '');
    authorLink.textContent = 'Loading member…';
    var date = document.createElement('time');
    date.className = 'post-time';
    date.textContent = timeLabel(data.createdAt);
    var privateAuthor = document.createElement('span');
    privateAuthor.className = 'post-private-author';
    privateAuthor.textContent = data.ownerUid === options.currentUid ? 'You' : '';
    authorMeta.append(authorLink, date);
    if (privateAuthor.textContent) authorMeta.appendChild(privateAuthor);
    header.append(avatar, authorMeta);
    article.appendChild(header);

    getAuthorProfile(data.ownerUid).then(function (author) {
      authorLink.href = author.username ? '/profile.html?username=' + encodeURIComponent(author.username) : '/profile.html?uid=' + encodeURIComponent(data.ownerUid || '');
      authorLink.replaceChildren(document.createTextNode(author.name));
      if (global.IBRVerifiedTick && global.IBRVerifiedTick.isValidEmail(author.email)) {
        var verifiedTick = global.IBRVerifiedTick.create(author.email);
        if (verifiedTick) authorLink.appendChild(verifiedTick);
      }
      avatar.alt = author.name + ' profile photo';
      avatar.src = author.photo || FALLBACK_PHOTO;
    });

    if (data.repostOf && typeof data.repostOf === 'object') {
      var repostNote = document.createElement('div');
      repostNote.className = 'post-repost-attribution';
      repostNote.style.cssText = 'font-size:.84rem;color:#64748b;background:#f8fafc;border-radius:8px;padding:.45rem .6rem;margin:.2rem 0 .65rem';
      repostNote.textContent = '🔁 Reposted from ' + (typeof data.repostOf.authorName === 'string' ? data.repostOf.authorName : 'another member');
      article.appendChild(repostNote);
    }

    var body = document.createElement('p');
    body.className = 'post-body';
    appendFormattedBody(body, data.bodyHtml, typeof data.body === 'string' ? data.body : '');
    article.appendChild(body);
    var previewBox = document.createElement('div');
    previewBox.className = 'post-url-previews';
    appendUrlPreview(previewBox, typeof data.body === 'string' ? data.body : '');
    if (previewBox.childNodes.length) article.appendChild(previewBox);

    var attachmentBox = document.createElement('div');
    attachmentBox.className = 'post-attachments';
    renderAttachments(attachmentBox, data.attachments);
    if (attachmentBox.childNodes.length) article.appendChild(attachmentBox);

    var footer = document.createElement('div');
    footer.className = 'post-actions';
    if (typeof options.onRepost === 'function' && data.ownerUid !== options.currentUid) {
      var repostButton = document.createElement('button');
      repostButton.type = 'button';
      repostButton.className = 'post-action-button post-repost-button';
      repostButton.setAttribute('aria-label', 'Repost this member post to your profile feed');
      repostButton.textContent = '🔁 Repost';
      repostButton.addEventListener('click', async function () {
        if (repostButton.disabled) return;
        repostButton.disabled = true;
        repostButton.textContent = 'Reposting…';
        try {
          await options.onRepost(post);
          repostButton.textContent = '✓ Reposted';
        } catch (error) {
          console.error('Unable to repost:', error);
          repostButton.textContent = '🔁 Repost';
          repostButton.disabled = false;
        }
      });
      footer.appendChild(repostButton);
    }

    if (options.showLike && typeof options.onLike === 'function') {
      var liked = Boolean(options.liked);
      var likeButton = document.createElement('button');
      likeButton.type = 'button';
      likeButton.className = 'post-action-button post-like-button' + (liked ? ' is-liked' : '');
      likeButton.textContent = liked ? '💜 Liked' : '💜 Like';
      likeButton.setAttribute('aria-pressed', liked ? 'true' : 'false');
      likeButton.addEventListener('click', async function () {
        if (likeButton.disabled) return;
        likeButton.disabled = true;
        try {
          liked = Boolean(await options.onLike(post, liked));
          likeButton.classList.toggle('is-liked', liked);
          likeButton.textContent = liked ? '💜 Liked' : '💜 Like';
          likeButton.setAttribute('aria-pressed', liked ? 'true' : 'false');
        } catch (error) {
          console.error('Unable to update private post like:', error);
        } finally {
          likeButton.disabled = false;
        }
      });
      footer.appendChild(likeButton);
    }

    if (options.showReplies && typeof options.onRepliesToggle === 'function') {
      var replyButton = document.createElement('button');
      replyButton.type = 'button';
      replyButton.className = 'post-action-button';
      replyButton.textContent = data.ownerUid === options.currentUid ? '💬 View replies' : '💬 Reply / replies';
      var replies = document.createElement('section');
      replies.className = 'post-replies';
      replies.hidden = true;
      replyButton.addEventListener('click', async function () {
        var opening = replies.hidden;
        replies.hidden = !opening;
        replyButton.textContent = opening ? 'Hide replies' : (data.ownerUid === options.currentUid ? '💬 View replies' : '💬 Reply / replies');
        if (opening) {
          replyButton.disabled = true;
          try {
            await options.onRepliesToggle(post, replies, replyButton, true, data.ownerUid !== options.currentUid);
          } catch (error) {
            console.error('Unable to open post replies:', error);
          } finally {
            replyButton.disabled = false;
          }
        }
      });
      footer.appendChild(replyButton);
      article.append(footer, replies);
    } else if (options.showReplies) {
      article.append(footer);
    } else {
      article.appendChild(footer);
    }

    if (options.allowDelete && data.ownerUid === options.currentUid && typeof options.onDelete === 'function') {
      var deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'post-action-button post-delete-button';
      deleteButton.textContent = 'Delete post';
      deleteButton.addEventListener('click', async function () {
        if (deleteButton.disabled) return;
        deleteButton.disabled = true;
        try {
          await options.onDelete(post, article);
          if (article.isConnected) deleteButton.disabled = false;
        } catch (error) {
          console.error('Unable to delete post:', error);
          deleteButton.disabled = false;
        }
      });
      footer.appendChild(deleteButton);
    }
    return article;
  }

  async function loadLikedIds(db, uid) {
    if (!db || !uid) return new Set();
    var snapshot = await db.collection('userPostLikes').doc(uid).collection('likes').get();
    return new Set(snapshot.docs.map(function (doc) { return doc.id; }));
  }

  global.ibrBrokerPosts = Object.freeze({
    createPostCard: createPostCard,
    getAuthorProfile: getAuthorProfile,
    loadLikedIds: loadLikedIds,
    sortNewest: sortNewest,
    timeLabel: timeLabel
  });
})(window);