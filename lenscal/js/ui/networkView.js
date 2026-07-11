/* LensCal — My Network: add by phone/invite link, mutual accept, groups. */
import { el, clear, toast, sheet, avatar, roleBadges, updatedBadge, emptyState } from './components.js';
import {
  requestByPhone, accept, remove, listenConnections, inviteLink,
  listGroups, createGroup, updateGroup, deleteGroup,
} from '../services/networkService.js';
import { getProfiles } from '../services/userService.js';
import { planOf } from '../services/planService.js';
import { getProfile } from '../services/userService.js';

export function renderNetwork(root, uid) {
  clear(root);
  const state = { connections: [], profiles: new Map(), groups: [], unsub: null };

  const addRow = el('div.add-row', {},
    el('input.input', { type: 'tel', placeholder: 'Add by phone number', inputmode: 'tel', id: 'add-phone' }),
    el('button.btn.btn-primary', {
      onclick: async function () {
        const input = document.getElementById('add-phone');
        if (!input.value.trim()) return;
        this.disabled = true;
        try {
          const target = await requestByPhone(uid, input.value);
          toast(`Request sent to ${target.name || 'user'} ✓`);
          input.value = '';
        } catch (e) { toast(e.message, 'err'); }
        this.disabled = false;
      },
    }, 'Add'),
  );

  const inviteRow = el('button.btn.btn-ghost.btn-full', {
    onclick: async () => {
      const link = inviteLink(uid);
      const me = await getProfile(uid);
      const text = `Join me on LensCal — shared availability calendar for wedding shoots. Connect with me: ${link}`;
      if (navigator.share) {
        navigator.share({ title: 'LensCal invite', text }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(text).catch(() => {});
        toast('Invite link copied — share it on WhatsApp');
      }
    },
  }, 'Share invite link');

  const counter = el('p.net-counter');
  const pendingBox = el('div.section');
  const listBox = el('div.section');
  const groupsBox = el('div.section');

  root.append(el('h1.page-title', {}, 'My Network'), addRow, inviteRow, counter, pendingBox, listBox, groupsBox);

  state.unsub = listenConnections(uid, async conns => {
    state.connections = conns;
    const uids = conns.map(c => c.otherUid);
    const profiles = await getProfiles(uids);
    state.profiles = new Map(profiles.map(p => [p.id, p]));
    draw();
  });

  refreshGroups();
  async function refreshGroups() {
    state.groups = await listGroups(uid).catch(() => []);
    draw();
  }

  function draw() {
    const accepted = state.connections.filter(c => c.status === 'accepted');
    const incoming = state.connections.filter(c => c.status === 'pending' && c.requestedBy !== uid);
    const outgoing = state.connections.filter(c => c.status === 'pending' && c.requestedBy === uid);

    getProfile(uid).then(me => {
      const max = planOf(me).maxConnections;
      counter.textContent = Number.isFinite(max)
        ? `${accepted.length} / ${max} connections (free plan)`
        : `${accepted.length} connections`;
    });

    clear(pendingBox);
    if (incoming.length || outgoing.length) {
      pendingBox.append(el('h2.section-title', {}, 'Requests'));
      for (const c of incoming) {
        const p = state.profiles.get(c.otherUid) || {};
        pendingBox.append(el('div.net-card', {},
          avatar(p, 44),
          el('div.crew-info', {},
            el('span.crew-name', {}, p.name || 'Unknown'),
            el('span.muted', {}, `${p.area || ''} ${p.city ? '· ' + p.city : ''} · wants to connect`)),
          el('button.btn.btn-primary.btn-sm', {
            onclick: async () => { await accept(uid, c.otherUid); toast('Connected ✓'); },
          }, 'Accept'),
          el('button.icon-btn', {
            onclick: async () => { await remove(uid, c.otherUid); toast('Declined'); }, 'aria-label': 'Decline',
          }, '✕'),
        ));
      }
      for (const c of outgoing) {
        const p = state.profiles.get(c.otherUid) || {};
        pendingBox.append(el('div.net-card.dim', {},
          avatar(p, 44),
          el('div.crew-info', {},
            el('span.crew-name', {}, p.name || 'Unknown'),
            el('span.muted', {}, 'Request sent — waiting for accept')),
          el('button.icon-btn', { onclick: async () => { await remove(uid, c.otherUid); }, 'aria-label': 'Cancel' }, '✕'),
        ));
      }
    }

    clear(listBox);
    listBox.append(el('h2.section-title', {}, 'Connections'));
    if (!accepted.length) {
      listBox.append(emptyState('🤝', 'No connections yet',
        'Add your crew by phone number, or share your invite link on WhatsApp.'));
    }
    for (const c of accepted) {
      const p = state.profiles.get(c.otherUid) || {};
      listBox.append(el('div.net-card', {},
        avatar(p, 44),
        el('div.crew-info', {},
          el('span.crew-name', {}, p.name || 'Unknown'),
          roleBadges(p.roles),
          el('div.crew-meta', {},
            el('span.muted', {}, [p.area, p.city].filter(Boolean).join(', ')),
            updatedBadge(p)),
        ),
        el('button.icon-btn', {
          onclick: () => {
            if (confirm(`Remove ${p.name || 'this connection'}?`)) {
              remove(uid, c.otherUid).then(() => toast('Removed'));
            }
          }, 'aria-label': 'Remove connection',
        }, '🗑'),
      ));
    }

    // Groups
    clear(groupsBox);
    groupsBox.append(el('div.section-head', {},
      el('h2.section-title', {}, 'Groups'),
      el('button.btn.btn-ghost.btn-sm', { onclick: () => openGroupSheet(null) }, '+ New group'),
    ));
    if (!state.groups.length) {
      groupsBox.append(el('p.muted', {}, 'Make groups like "Core Team" or "Drone Guys" to filter searches.'));
    }
    for (const g of state.groups) {
      groupsBox.append(el('div.net-card', { onclick: () => openGroupSheet(g) },
        el('div.group-avatar', {}, '👥'),
        el('div.crew-info', {},
          el('span.crew-name', {}, g.name),
          el('span.muted', {}, `${g.memberUids.length} member${g.memberUids.length === 1 ? '' : 's'}`)),
        el('span.muted', {}, '›'),
      ));
    }

    function openGroupSheet(group) {
      const members = new Set(group ? group.memberUids : []);
      const nameInput = el('input.input', { value: group ? group.name : '', placeholder: 'Group name (e.g. Core Team)' });
      const memberList = el('div.member-list', {}, accepted.map(c => {
        const p = state.profiles.get(c.otherUid) || {};
        const row = el('button.member-row', {
          class: `member-row ${members.has(c.otherUid) ? 'on' : ''}`,
          onclick: () => {
            members.has(c.otherUid) ? members.delete(c.otherUid) : members.add(c.otherUid);
            row.classList.toggle('on');
          },
        }, avatar(p, 32), el('span', {}, p.name || 'Unknown'), el('span.check', {}, '✓'));
        return row;
      }));
      const s = sheet(group ? 'Edit group' : 'New group', el('div', {},
        nameInput, memberList,
        el('button.btn.btn-primary.btn-full', {
          onclick: async () => {
            const name = nameInput.value.trim();
            if (!name) return toast('Give the group a name', 'err');
            if (group) await updateGroup(group.id, { name, memberUids: [...members] });
            else await createGroup(uid, name, [...members]);
            s.close(); refreshGroups(); toast('Group saved ✓');
          },
        }, 'Save group'),
        group ? el('button.btn.btn-ghost.btn-full.danger', {
          onclick: async () => { await deleteGroup(group.id); s.close(); refreshGroups(); toast('Group deleted'); },
        }, 'Delete group') : null,
      ));
    }
  }

  return () => { if (state.unsub) state.unsub(); };
}
