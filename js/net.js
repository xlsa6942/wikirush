// Connexion entre appareils, sans serveur à nous : WebRTC via PeerJS.
// La personne qui crée la partie (l'hôte) garde l'état de la partie et le
// renvoie aux autres à chaque changement.

export const PEER_PREFIX = 'wikirush-v1-';

const FRUITS = [
  'BANANE', 'MANGUE', 'KIWI', 'CERISE', 'POMME', 'FRAISE', 'ANANAS', 'CITRON', 'MELON', 'PRUNE',
  'LITCHI', 'PAPAYE', 'POIRE', 'FIGUE', 'DATTE', 'GOYAVE', 'PECHE', 'MYRTILLE', 'GRENADE', 'COCO',
];

export function makeCode() {
  return FRUITS[Math.floor(Math.random() * FRUITS.length)] + String(Math.floor(Math.random() * 90) + 10);
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function peerOptions() {
  const q = new URLSearchParams(location.search);
  const o = {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    },
  };
  // Option de test : serveur PeerJS local (?peerhost=localhost&peerport=9000)
  if (q.get('peerhost')) {
    o.host = q.get('peerhost');
    o.port = Number(q.get('peerport') || 9000);
    o.path = q.get('peerpath') || '/';
    o.secure = q.get('peersecure') === '1';
  }
  return o;
}

function needPeer() {
  if (!window.Peer) throw new Error('La connexion multijoueur n\'a pas pu se charger. Recharge la page.');
}

// Ouvre une salle. Renvoie { peer, code }.
export function openHost() {
  needPeer();
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = makeCode();
      const peer = new window.Peer(PEER_PREFIX + code, peerOptions());
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error('timeout'));
      }, 15000);
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ peer, code });
      });
      peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        if (err.type === 'unavailable-id' && tries++ < 6) attempt();
        else reject(err);
      });
    };
    attempt();
  });
}

// Rejoint une salle. Renvoie { peer, conn }.
export function openGuest(code) {
  needPeer();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(undefined, peerOptions());
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail({ type: 'timeout' }), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ peer, conn });
      });
      conn.on('error', fail);
    });
    peer.on('error', fail);
  });
}

// Reconnexion d'une invitée avec le même objet Peer.
export function reconnectGuest(peer, code) {
  return new Promise((resolve, reject) => {
    if (!peer || peer.destroyed) return reject(new Error('destroyed'));
    const go = () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      const done = (fn, v) => { clearTimeout(timer); peer.off('error', onPeerError); fn(v); };
      const onPeerError = (e) => { if (e.type === 'peer-unavailable') done(reject, e); };
      const timer = setTimeout(() => done(reject, new Error('timeout')), 6000);
      peer.on('error', onPeerError);
      conn.on('open', () => done(resolve, conn));
      conn.on('error', (e) => done(reject, e));
    };
    if (peer.disconnected) {
      peer.reconnect();
      peer.once('open', go);
    } else {
      go();
    }
  });
}
