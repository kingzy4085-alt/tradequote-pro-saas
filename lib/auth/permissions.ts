export const Permissions = {

  owner: ['*'],

  admin: [
    'projects',
    'estimates',
    'proposals',
    'rfis',
    'inventory'
  ],

  project_manager: [
    'projects',
    'estimates',
    'proposals',
    'rfis'
  ],

  foreman: [
    'daily_logs',
    'timecards',
    'rfis'
  ],

  electrician: [
    'timecards'
  ],

  client: [
    'proposals'
  ]

}
