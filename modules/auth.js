/**
 * modules/auth.js
 * Gère l'authentification via l'API Google Apps Script.
 */

export const Auth = {
    apiUrl: "https://script.google.com/macros/s/AKfycbyFxif6QkH3iobmoh-KPdpbo7slmtwQnhQLt9kRnBIEzEnjgmkFYIFASAldH2Puxl8Z/exec",
    
    init() {
        console.log("[Auth] Initialisation du module...");
        const loginBtn = document.getElementById('btn-login');
        const passInput = document.getElementById('auth-password');

        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.handleLogin());
        }

        if (passInput) {
            passInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleLogin();
            });
        }
    },

    /**
     * Procédure de connexion
     */
    async handleLogin() {
        const password = document.getElementById('auth-password').value;
        const btn = document.getElementById('btn-login');
        const errorMsg = document.getElementById('auth-error');

        if (!password) return;

        // UI Loading state
        btn.disabled = true;
        btn.innerHTML = `<span class="animate-pulse">Vérification...</span>`;
        if (errorMsg) errorMsg.classList.add('hidden');

        try {
            // Note: On utilise 'fetch' avec POST. 
            // Pour lire la réponse d'un script Google, le mode 'cors' est nécessaire.
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                body: JSON.stringify({ password: password })
            });

            const result = await response.json();

            if (result.status === "success") {
                console.log(`[Auth] Réponse brute userName:`, result.userName);
                console.log(`[Auth] Bienvenue ${result.userName}`);
                
                // On passe à l'étape suivante avec les infos utilisateur
                window.dispatchEvent(new CustomEvent('nextStep', {
                    detail: { 
                        data: { 
                            isAuthenticated: true, 
                            userName: result.userName 
                        }, 
                        next: 'step-csv' 
                    }
                }));
            } else {
                this.showError(result.message || "Accès refusé.");
            }
        } catch (error) {
            console.error("[Auth] Erreur:", error);
            this.showError("Erreur de connexion au serveur d'authentification.");
        } finally {
            btn.disabled = false;
            btn.innerHTML = "Se connecter";
        }
    },

    showError(msg) {
        const errorMsg = document.getElementById('auth-error');
        if (errorMsg) {
            errorMsg.innerText = msg;
            errorMsg.classList.remove('hidden');
        }
    }
};
