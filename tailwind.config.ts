import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			// Slack color palette
  			slack: {
  				purple: '#3F0E40',
  				'purple-dark': '#350D36',
  				'purple-hover': '#461447',
  				blue: '#1264A3',
  				'blue-hover': '#0F4F82',
  				'blue-light': '#D9E8F5',
  				red: '#E01E5A',
  				green: '#2BAC76',
  				yellow: '#ECB22E',
  				white: '#FFFFFF',
  				'text-white': '#FFFFFF',
  				'text-muted': '#BCA9BD',
  				'channel-active': '#1264A3',
  			},
  			sidebar: {
  				DEFAULT: '#3F0E40',
  				hover: '#350D36',
  				active: '#1264A3',
  				foreground: '#FFFFFF',
  				muted: '#BCA9BD',
  			},
  			surface: '#F8F8F8',
  			ice: '#CADCFC',
  			accent: {
  				DEFAULT: '#1264A3',
  				hover: '#0F4F82',
  				light: 'rgba(18, 100, 163, 0.1)',
  			},
  			success: '#2BAC76',
  			warning: '#ECB22E',
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
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		boxShadow: {
  			'card': '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
  			'card-hover': '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
  			'header': '0 1px 3px rgba(0, 0, 0, 0.08)',
  			'panel': '0 2px 8px rgba(0, 0, 0, 0.06)',
  		},
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
export default config;
