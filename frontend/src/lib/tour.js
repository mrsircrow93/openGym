// The first-run walkthrough.
//
// Testers installed the app and did nothing: eight of eleven had logged zero workouts, and the
// ones who wrote back said they did not know where to start or how to connect a watch. So this
// is a tour of the real screens, not a slideshow of pictures — each step moves to the tab it is
// describing, so the thing being explained is underneath the words.
//
// It runs once, on the first sign-in, and `S.tourDone` is part of the synced profile so a second
// device does not run it again. Skipping counts as finishing: being shown the door twice after
// saying no is worse than never being shown it.
export const TOUR_STEPS = [
  { route: '/home', icon: 'house', title: 'Your day at a glance',
    body: 'Home shows what is planned for today, your weight, your water and your steps. Everything you log lands here.' },
  { route: '/plan', icon: 'calendar', title: 'Your week',
    body: 'Set what you train each day, or let the coach build the whole week from a few questions.' },
  { route: '/home', icon: 'play', title: 'Start a workout',
    body: 'The green button in the middle starts the session. Tick each set as you go and the app handles your rest timer, your records and the weight to use next time.' },
  { route: '/nutrition', icon: 'utensils', title: 'Food, from a photo',
    body: 'Take a picture of a meal and the app estimates its calories and macros. You can also write it, or import a diet plan.' },
  { route: '/stats', icon: 'chart', title: 'Progress you can see',
    body: 'Charts for every exercise, your estimated one-rep max, badges and monthly progress photos.' },
  { route: '/settings', icon: 'heart', title: 'Connect your watch',
    body: 'In Settings, turn on Apple Health or Health Connect and your steps and weigh-ins come across on their own — from whatever watch you already wear.' }
]

export const tourPending = S => !!S && !S.tourDone
