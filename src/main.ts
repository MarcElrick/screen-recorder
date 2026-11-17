import { mount } from 'svelte'
import './ui/app.css'
import App from './ui/App.svelte'

export default mount(App, { target: document.getElementById('app')! })
