/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
  			mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
  		},
  		borderRadius: {
  			sm: "var(--pac-radius-sm)",
  			md: "var(--pac-radius-md)",
  			lg: "var(--pac-radius-lg)",
  		},
  		boxShadow: {
  			"pac-1": "var(--pac-shadow-1)",
  			"pac-2": "var(--pac-shadow-2)",
  			"pac-3": "var(--pac-shadow-3)",
  		},
  		transitionTimingFunction: {
  			pac: "cubic-bezier(.2,.7,.2,1)",
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			pac: {
  				blue: {
  					50: "var(--pac-blue-50)",
  					100: "var(--pac-blue-100)",
  					300: "var(--pac-blue-300)",
  					500: "var(--pac-blue-500)",
  					600: "var(--pac-blue-600)",
  					700: "var(--pac-blue-700)",
  					800: "var(--pac-blue-800)",
  					900: "var(--pac-blue-900)",
  				},
  				ink: {
  					300: "var(--pac-ink-300)",
  					400: "var(--pac-ink-400)",
  					500: "var(--pac-ink-500)",
  					700: "var(--pac-ink-700)",
  					800: "var(--pac-ink-800)",
  					900: "var(--pac-ink-900)",
  				},
  				line: {
  					100: "var(--pac-line-100)",
  					200: "var(--pac-line-200)",
  					300: "var(--pac-line-300)",
  				},
  				bg: {
  					50: "var(--pac-bg-50)",
  					100: "var(--pac-bg-100)",
  				},
  				paper: "var(--pac-paper)",
  				accent: {
  					DEFAULT: "var(--pac-accent)",
  					hover: "var(--pac-accent-hover)",
  				},
  				signal: {
  					green: "var(--pac-signal-green)",
  					"green-bg": "var(--pac-signal-green-bg)",
  					amber: "var(--pac-signal-amber)",
  					"amber-bg": "var(--pac-signal-amber-bg)",
  					red: "var(--pac-signal-red)",
  					"red-bg": "var(--pac-signal-red-bg)",
  					blue: "var(--pac-signal-blue)",
  					"blue-bg": "var(--pac-signal-blue-bg)",
  				},
  			},
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
