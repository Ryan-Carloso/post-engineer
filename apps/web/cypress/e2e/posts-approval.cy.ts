const SCHEDULE_ID = 'sched-e2e-approval';
const ASAP_SCHEDULE_ID = 'sched-e2e-approval-asap';
const FRESH_SLOT_ID = 'slot-e2e-await-fresh';
const EXPIRED_SLOT_ID = 'slot-e2e-await-expired';
const ASAP_SLOT_ID = 'slot-e2e-await-asap';

function visitPosts() {
  cy.visit('/posts', {
    onBeforeLoad(win) {
      win.localStorage.setItem('post-engineer-onboarding-wizard-seen', '1');
    },
  });
}

function personasPayload() {
  return {
    authenticated: true,
    personas: [{ id: 'persona-e2e-1', name: 'E2E Persona', niche: 'e2e', avatarUrl: null, photoUrl: null }],
  };
}

function postAccountsPayload() {
  return {
    authenticated: true,
    accounts: [
      {
        provider: 'youtube',
        recordId: 'rec-yt-1',
        channelId: 'ch-e2e-1',
        channelName: 'E2E Channel',
        email: 'e2e@example.com',
        thumbnail: null,
        connectedAt: Date.now(),
        lastUsed: Date.now(),
      },
    ],
  };
}

function schedulesPayload() {
  return {
    success: true,
    schedules: [
      {
        id: SCHEDULE_ID,
        persona_id: 'persona-e2e-1',
        providers: ['youtube'],
        youtube_account_ids: ['ch-e2e-1'],
        instagram_account_ids: [],
        linkedin_account_ids: [],
        bluesky_account_ids: [],
        threads_account_ids: [],
        facebook_account_ids: [],
        pinterest_account_ids: [],
        pinterest_board_id: null,
        threespeak_account_ids: [],
        rumble_account_ids: [],
        fanvue_account_ids: [],
        telegram_account_ids: [],
        days_of_week: [],
        start_hour: null,
        end_hour: null,
        posts_per_day: 1,
        timezone: 'Europe/Lisbon',
        publish_mode: 'scheduled',
        active: true,
      },
      {
        id: ASAP_SCHEDULE_ID,
        persona_id: 'persona-e2e-1',
        providers: ['youtube'],
        youtube_account_ids: ['ch-e2e-1'],
        instagram_account_ids: [],
        linkedin_account_ids: [],
        bluesky_account_ids: [],
        threads_account_ids: [],
        facebook_account_ids: [],
        pinterest_account_ids: [],
        pinterest_board_id: null,
        threespeak_account_ids: [],
        rumble_account_ids: [],
        fanvue_account_ids: [],
        telegram_account_ids: [],
        days_of_week: [],
        start_hour: null,
        end_hour: null,
        posts_per_day: 1,
        timezone: 'Europe/Lisbon',
        publish_mode: 'asap',
        active: true,
      },
    ],
  };
}

function freshSlot() {
  return {
    id: FRESH_SLOT_ID,
    schedule_id: SCHEDULE_ID,
    slot_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: 'awaiting_approval',
    title: 'Held video',
    description: 'Edited outside.',
    media: { kind: 'image', url: null, contentType: 'image/jpeg' },
  };
}

function expiredSlot() {
  return {
    id: EXPIRED_SLOT_ID,
    schedule_id: SCHEDULE_ID,
    slot_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: 'awaiting_approval',
    title: 'Late video',
    description: 'Edited outside.',
    media: { kind: 'image', url: null, contentType: 'image/jpeg' },
  };
}

function asapSlot() {
  return {
    id: ASAP_SLOT_ID,
    schedule_id: ASAP_SCHEDULE_ID,
    slot_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    status: 'awaiting_approval',
    title: 'ASAP hold',
    description: 'Edited outside.',
    media: { kind: 'image', url: null, contentType: 'image/jpeg' },
  };
}

describe('Posts approval queue', () => {
  const decided = new Set<string>();

  beforeEach(() => {
    decided.clear();
    cy.loginE2EUser();

    cy.intercept('GET', '/api/persona/list', personasPayload()).as('personas');
    cy.intercept('GET', '/api/account', postAccountsPayload()).as('accounts');
    cy.intercept('GET', '/api/schedule', schedulesPayload()).as('schedules');
    cy.intercept('GET', '/api/schedule/status*', (req) => {
      const upcoming = [freshSlot(), expiredSlot(), asapSlot()].filter((slot) => !decided.has(slot.id));
      if (req.url.includes('limit=')) {
        req.reply({ success: true, upcoming, recent: [], hasAnyPost: true });
      } else {
        req.reply({ success: true, slots: [freshSlot(), expiredSlot(), asapSlot()], truncated: false });
      }
    }).as('status');
    cy.intercept('POST', `/api/schedule/slots/${FRESH_SLOT_ID}/approve`, (req) => {
      decided.add(FRESH_SLOT_ID);
      req.reply({ success: true, status: 'ready' });
    }).as('approveFresh');
    cy.intercept('POST', `/api/schedule/slots/${ASAP_SLOT_ID}/approve`, (req) => {
      decided.add(ASAP_SLOT_ID);
      req.reply({ success: true, status: 'ready' });
    }).as('approveAsap');
    cy.intercept('POST', `/api/schedule/slots/${EXPIRED_SLOT_ID}/reject`, (req) => {
      decided.add(EXPIRED_SLOT_ID);
      req.reply({ success: true, status: 'cancelled' });
    }).as('rejectExpired');
    cy.intercept('PATCH', `/api/schedule/slots/${EXPIRED_SLOT_ID}`, { success: true, slotAt: '2030-06-01T10:00:00.000Z' }).as(
      'rescheduleExpired',
    );
  });

  it('shows the queue with title, description, accounts and the nav badge', () => {
    visitPosts();

    cy.get('[data-testid=approval-queue]').should('exist');
    cy.get('[data-testid=approval-queue-count]').should('contain', '3');
    cy.get('[data-testid=nav-posts-approval-badge]').should('contain', '3');
    cy.contains('[data-testid=approval-queue-row]', 'Held video').within(() => {
      cy.contains('Edited outside.').should('be.visible');
      cy.contains('E2E Persona').should('be.visible');
      cy.get('[data-testid=approval-approve]').should('be.visible');
      cy.get('[data-testid=approval-reject]').should('be.visible');
    });
  });

  it('approves a slot and drops it from the queue and the badge', () => {
    visitPosts();

    cy.contains('[data-testid=approval-queue-row]', 'Held video').within(() => {
      cy.get('[data-testid=approval-approve]').click();
    });
    cy.wait('@approveFresh');
    cy.get('[data-testid=approval-queue-count]').should('contain', '2');
    cy.get('[data-testid=nav-posts-approval-badge]').should('contain', '2');
    cy.contains('[data-testid=approval-queue-row]', 'Held video').should('not.exist');
    cy.contains('[data-testid=approval-queue-row]', 'Late video').should('exist');
  });

  it('keeps an old ASAP hold approvable without an expired badge and approves it', () => {
    visitPosts();

    cy.contains('[data-testid=approval-queue-row]', 'ASAP hold').within(() => {
      cy.get('[data-testid=approval-expired]').should('not.exist');
      cy.get('[data-testid=approval-approve]').should('be.enabled');
      cy.get('[data-testid=approval-reschedule]').should('not.exist');
      cy.get('[data-testid=approval-approve]').click();
    });
    cy.wait('@approveAsap');
    cy.get('[data-testid=approval-queue-count]').should('contain', '2');
    cy.contains('[data-testid=approval-queue-row]', 'ASAP hold').should('not.exist');
  });

  it('rejects a slot and drops it from the queue', () => {
    visitPosts();

    cy.contains('[data-testid=approval-queue-row]', 'Late video').within(() => {
      cy.get('[data-testid=approval-reject]').click();
    });
    cy.wait('@rejectExpired');
    cy.get('[data-testid=approval-queue-count]').should('contain', '2');
    cy.contains('[data-testid=approval-queue-row]', 'Late video').should('not.exist');
  });

  it('marks an expired slot, disables approve and offers reschedule', () => {
    visitPosts();

    cy.contains('[data-testid=approval-queue-row]', 'Late video').within(() => {
      cy.get('[data-testid=approval-expired]').should('be.visible');
      cy.get('[data-testid=approval-approve]').should('be.disabled');
      cy.get('[data-testid=approval-reschedule]').click();
      cy.get('input[type="datetime-local"]').then(($input) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter?.call($input[0], '2030-06-01T10:00');
        $input[0].dispatchEvent(new Event('input', { bubbles: true }));
      });
      cy.contains('button', 'Salvar').click();
    });
    cy.wait('@rescheduleExpired').its('request.body').should('deep.equal', { slotAt: '2030-06-01T10:00:00.000Z' });
  });
});

export {};
