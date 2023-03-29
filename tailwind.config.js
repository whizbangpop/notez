/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{ejs,js}"],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms')
  ],
}

