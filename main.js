/**
 * main.js - Orchestrateur Central
 * Correction : Nettoyage "Bulldozer" du nom d'utilisateur
 */

import { Auth } from './modules/auth.js';
import { CSVParser } from './modules/csv_parser.js';
import { Geocoder } from './modules/geocoder.js';
import { RouterAPI } from './modules/router_api.js';
import { MapDisplay } from './modules/map_display.js';
import { Analytics } from './modules/analytics.js';

const App = {
    // État global
    appState: {
        currentStep: 'step-auth',
        isAuthenticated: false,
        userName: null,
        rawData: null,
        coordinates: null,
        routes: null,
        isochrones: null
    },

    stepsOrder: ['step-auth', 'step-csv', 'step-geo', 'step-route', 'step-map'],

    /**
     * Utilitaire de nettoyage ULTRA ROBUSTE
     * Cible spécifiquement "Connecté en tant que" pour l'éradiquer.
     */
    cleanName(name) {
        if (!name) return "Anonyme";
        
        let cleaned = String(name);

        // 1. Si on trouve "en tant que" (peu importe la casse), on coupe tout ce qu'il y a avant
        // Le regex remplace "tout ce qui précède + connecté en tant que + espace/deux-points" par vide
        cleaned = cleaned.replace(/.*(connecté|en tant que|bienvenue)\s*[:]*\s*/gi, '');

        // 2. Sécurité supplémentaire : s'il reste un ":" qui traîne
        if (cleaned.includes(':')) {
            cleaned = cleaned.split(':').pop();
        }

        // 3. Trim final pour virer les espaces
        return cleaned.trim();
    },

    /**
     * Initialisation globale
     */
    init() {
        console.log("[App] Initialisation du système...");
        window.App = this; 

        Auth.init();
        CSVParser.init();
        Geocoder.init();
        RouterAPI.init();
        
        window.addEventListener('nextStep', (event) => this.handleNavigation(event));
    },

    /**
     * Gestion de la navigation
     */
    handleNavigation(event) {
        let { data, next } = event.detail;

        // Nettoyage immédiat du nom d'utilisateur dès qu'il arrive
        if (data && data.userName) {
            console.log(`[App] Avant nettoyage:`, data.userName); // ← ajoute ça
            data.userName = this.cleanName(data.userName);
            console.log(`[App] Après nettoyage:`, data.userName);
        }

        console.log(`[App] Transition vers : ${next}`);
        
        this.appState = { ...this.appState, ...data, currentStep: next };

        this.triggerModuleLogic(next);
        this.updateUI(next);
    },

    /**
     * Déclenchement de la logique métier
     */
    triggerModuleLogic(stepId) {
        switch(stepId) {
            case 'step-csv':
                const welcome = document.getElementById('user-welcome');
                if (welcome && this.appState.userName) {
                    welcome.dataset.rawName = this.appState.userName;
                    welcome.innerText = this.appState.userName;
                }
                break;
            case 'step-geo':
                if (this.appState.rawData) Geocoder.startGeocoding(this.appState.rawData);
                break;
            case 'step-route':
                console.log(`[Log] Début calcul itinéraire pour : ${this.appState.userName}`);
                if (this.appState.coordinates) {
                    // On envoie le nom propre au routeur
                    RouterAPI.startRouting(this.appState.coordinates, this.appState.userName);
                }
                break;
            case 'step-map':
                if (this.appState.routes) {
                    MapDisplay.render(this.appState);
                    Analytics.init(this.appState);
                    
                    const sess = document.getElementById('session-info');
                    if (sess) {
                        sess.innerText = this.appState.userName;
                    }
                }
                break;
        }
    },

    /**
     * Mise à jour visuelle
     */
    updateUI(stepId) {
        document.querySelectorAll('.step-view').forEach(section => {
            section.classList.toggle('active', section.id === stepId);
        });

        const index = this.stepsOrder.indexOf(stepId);
        if (index !== -1) {
            const progress = (index / (this.stepsOrder.length - 1)) * 100;
            const bar = document.getElementById('progress-bar');
            const indicator = document.getElementById('step-indicator');
            
            if (bar) bar.style.width = `${progress}%`;
            
            if (indicator) {
                if (stepId === 'step-auth') {
                    indicator.innerText = "Authentification";
                } else {
                    indicator.innerText = `Étape ${index} sur ${this.stepsOrder.length - 1}`;
                }
            }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
