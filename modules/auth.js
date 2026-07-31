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

    async handleLogin() {
        const password = document.getElementById('auth-password').value;
        const btn = document.getElementById('btn-login');
        const errorMsg = document.getElementById('auth-error');

        if (!password) return;

        btn.disabled = true;
        btn.innerHTML = `<span class="animate-pulse">Vérification...</span>`;
        if (errorMsg) errorMsg.classList.add('hidden');

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                body: JSON.stringify({ password: password })
            });

            const result = await response.json();

            if (result.status === "success") {
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
            btn.innerHTML = "Accéder au Système";
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
