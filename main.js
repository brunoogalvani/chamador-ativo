// Configurações da API 360dialog
const API_CONFIG = {
    baseUrl: 'https://waba.360dialog.io/v1', // URL base da API 360dialog
    apiKey: '', // Será configurado pelo usuário ou via Rocket.Chat
    instanceId: '', // ID da instância WhatsApp
    modoTeste: true // Define true para simular envio sem chamar a API real
};

// Variáveis globais
let templatesList = [];
let currentTemplate = null;
let placeholders = [];
let placeholderValues = {};

// Elementos DOM
const telefoneInput = document.getElementById('telefone');
const templateSelect = document.getElementById('template-select');
const dynamicFieldsContainer = document.getElementById('dynamic-fields-container');
const dynamicFields = document.getElementById('dynamic-fields');
const previewContainer = document.getElementById('preview-container');
const previewText = document.getElementById('preview-text');
const dispararBtn = document.getElementById('disparar-btn');
const messageForm = document.getElementById('messageForm');
const statusMessage = document.getElementById('status-message');

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
    await carregarTemplates();
    setupEventListeners();
});

/**
 * Carrega templates da API 360dialog
 */
async function carregarTemplates() {
    // Buscar API Key e Instance ID do Rocket.Chat ou configuração
    const apiKey = getApiKeyFromRocketChat() || API_CONFIG.apiKey;
    const instanceId = getInstanceIdFromRocketChat() || API_CONFIG.instanceId;
    
    // Se não houver credenciais, usar fallback imediatamente (modo teste)
    if (!apiKey || !instanceId || API_CONFIG.modoTeste) {
        templatesList = getFallbackTemplates();
        popularSelectTemplates();
        showStatus('✅ Modo Teste: Templates de exemplo carregados', 'success');
        return;
    }

    // Tentar carregar da API apenas se tiver credenciais
    try {
        showStatus('Carregando templates da API...', 'info');

        const response = await fetch(`${API_CONFIG.baseUrl}/configs/templates?instance_id=${instanceId}`, {
            method: 'GET',
            headers: {
                'D360-API-KEY': apiKey,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Erro ao carregar templates: ${response.statusText}`);
        }

        const data = await response.json();
        
        // A estrutura da resposta pode variar, ajuste conforme necessário
        templatesList = data.templates || data || [];
        
        if (templatesList.length === 0) {
            throw new Error('Nenhum template encontrado');
        }
        
        popularSelectTemplates();
        showStatus('Templates carregados com sucesso!', 'success');
        
    } catch (error) {
        console.error('Erro ao carregar templates:', error);
        
        // Fallback: usar templates de exemplo para desenvolvimento
        templatesList = getFallbackTemplates();
        popularSelectTemplates();
        showStatus('⚠️ Erro ao carregar templates da API. Usando templates de exemplo (modo teste).', 'warning');
    }
}

/**
 * Templates de fallback para desenvolvimento/teste
 */
function getFallbackTemplates() {
    return [
        {
            name: 'ass_primeiro-acesso',
            category: 'ASSISTENTE',
            language: 'pt_BR',
            status: 'APPROVED',
            components: [
                {
                    type: 'BODY',
                    text: 'Olá {{nome}}! Detectamos seu primeiro acesso. Podemos confirmar alguns dados?'
                }
            ]
        },
        {
            name: 'bol_segunda-via',
            category: 'UTILITY',
            language: 'pt_BR',
            status: 'APPROVED',
            components: [
                {
                    type: 'BODY',
                    text: 'Olá {{nome}}, sua segunda via do boleto {{numero_boleto}} foi gerada. Valor: R$ {{valor}}. Podemos enviá-la agora?'
                }
            ]
        },
        {
            name: 'bol_boleto-atrasado',
            category: 'UTILITY',
            language: 'pt_BR',
            status: 'APPROVED',
            components: [
                {
                    type: 'BODY',
                    text: 'Seu boleto {} venceu há {} dias. Gostaria de receber um link atualizado?'
                }
            ]
        }
    ];
}

/**
 * Formata o nome do template removendo prefixos (bol_, ass_, etc.)
 */
function formatarNomeTemplate(nomeOriginal) {
    // Remove prefixos comuns como bol_, ass_, etc.
    let nomeFormatado = nomeOriginal.replace(/^(bol_|ass_|msg_|notif_)/i, '');
    
    // Substitui underscores por espaços
    nomeFormatado = nomeFormatado.replace(/-/g, ' ');
    
    // Capitaliza primeira letra de cada palavra
    nomeFormatado = nomeFormatado.replace(/\b\w/g, l => l.toUpperCase());
    
    return nomeFormatado;
}

/**
 * Popula o select com os templates disponíveis
 */
function popularSelectTemplates() {
    templateSelect.innerHTML = '<option value="" selected disabled>Selecione um template</option>';
    
    templatesList.forEach(template => {
        const option = document.createElement('option');
        option.value = template.name;
        // Formata o nome para exibição mas mantém o nome original no value
        const nomeFormatado = formatarNomeTemplate(template.name);
        option.textContent = nomeFormatado;
        option.dataset.template = JSON.stringify(template);
        templateSelect.appendChild(option);
    });
}

/**
 * Detecta placeholders no texto (suporta {} e {{variable}})
 */
function detectarPlaceholders(texto) {
    const placeholders = [];
    
    // Padrão 1: {{variable}} (nomeado)
    const padraoNomeado = /\{\{(\w+)\}\}/g;
    let match;
    
    while ((match = padraoNomeado.exec(texto)) !== null) {
        const nome = match[1];
        if (!placeholders.find(p => p.nome === nome)) {
            placeholders.push({
                nome: nome,
                tipo: 'nomeado',
                padrao: match[0],
                index: match.index
            });
        }
    }
    
    // Padrão 2: {} (anônimo/posicional)
    const padraoAnonimo = /\{\}/g;
    let matchAnonimo;
    let contadorAnonimo = 1;
    
    while ((matchAnonimo = padraoAnonimo.exec(texto)) !== null) {
        // Verifica se já não foi capturado como nomeado
        const jaCapturado = placeholders.some(p => 
            p.index <= matchAnonimo.index && 
            matchAnonimo.index < p.index + p.padrao.length
        );
        
        if (!jaCapturado) {
            placeholders.push({
                nome: `var_${contadorAnonimo}`,
                tipo: 'anonimo',
                padrao: '{}',
                index: matchAnonimo.index
            });
            contadorAnonimo++;
        }
    }
    
    // Ordena por posição no texto
    placeholders.sort((a, b) => a.index - b.index);
    
    return placeholders;
}

/**
 * Extrai o texto do template
 */
function extrairTextoTemplate(template) {
    // Procura o componente do tipo BODY
    const bodyComponent = template.components?.find(comp => comp.type === 'BODY');
    return bodyComponent?.text || '';
}

/**
 * Processa a seleção de template
 */
function processarTemplateSelecionado() {
    const selectedOption = templateSelect.options[templateSelect.selectedIndex];
    
    if (!selectedOption || !selectedOption.value) {
        currentTemplate = null;
        placeholders = [];
        placeholderValues = {};
        ocultarCamposDinamicos();
        previewContainer.style.display = 'none';
        document.getElementById('template-text-container')?.remove();
        return;
    }
    
    currentTemplate = JSON.parse(selectedOption.dataset.template);
    const textoTemplate = extrairTextoTemplate(currentTemplate);
    
    // Mostra o texto do template
    mostrarTextoTemplate(textoTemplate);
    
    // Detecta placeholders
    placeholders = detectarPlaceholders(textoTemplate);
    
    // Limpa valores anteriores
    placeholderValues = {};
    
    // Gera campos dinamicamente
    if (placeholders.length > 0) {
        gerarCamposDinamicos();
        mostrarCamposDinamicos();
    } else {
        ocultarCamposDinamicos();
    }
    
    // Atualiza preview (sempre mostra, mesmo sem campos preenchidos)
    atualizarPreview();
    
    // Verifica se pode habilitar botão
    verificarHabilitacaoBotao();
}

/**
 * Mostra o texto do template selecionado
 */
function mostrarTextoTemplate(texto) {
    // Remove container anterior se existir
    const containerAnterior = document.getElementById('template-text-container');
    if (containerAnterior) {
        containerAnterior.remove();
    }
    
    // Cria novo container
    const templateGroup = templateSelect.closest('.form-group');
    const container = document.createElement('div');
    container.id = 'template-text-container';
    container.className = 'template-text-container';
    
    const label = document.createElement('label');
    label.textContent = 'Texto do template:';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'template-text-display';
    textDiv.textContent = texto;
    
    container.appendChild(label);
    container.appendChild(textDiv);
    
    // Insere após o select
    templateGroup.appendChild(container);
}

/**
 * Gera campos de input dinamicamente
 */
function gerarCamposDinamicos() {
    dynamicFields.innerHTML = '';
    
    placeholders.forEach((placeholder, index) => {
        const fieldGroup = document.createElement('div');
        fieldGroup.className = 'dynamic-field-group';
        
        const label = document.createElement('label');
        label.textContent = placeholder.tipo === 'nomeado' 
            ? placeholder.nome.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
            : `Variável ${index + 1}`;
        label.setAttribute('for', `field_${placeholder.nome}`);
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `field_${placeholder.nome}`;
        input.className = 'dynamic-input';
        input.placeholder = `Digite o valor para ${placeholder.nome}`;
        input.dataset.placeholderName = placeholder.nome;
        input.dataset.placeholderPattern = placeholder.padrao;
        
        // Event listener para atualizar em tempo real
        input.addEventListener('input', () => {
            placeholderValues[placeholder.nome] = input.value;
            atualizarPreview();
            verificarHabilitacaoBotao();
        });
        
        fieldGroup.appendChild(label);
        fieldGroup.appendChild(input);
        dynamicFields.appendChild(fieldGroup);
    });
}

/**
 * Mostra a área de campos dinâmicos
 */
function mostrarCamposDinamicos() {
    dynamicFieldsContainer.style.display = 'block';
}

/**
 * Oculta a área de campos dinâmicos
 */
function ocultarCamposDinamicos() {
    dynamicFieldsContainer.style.display = 'none';
}

/**
 * Atualiza o preview da mensagem em tempo real
 */
function atualizarPreview() {
    if (!currentTemplate) {
        previewContainer.style.display = 'none';
        return;
    }
    
    const textoTemplate = extrairTextoTemplate(currentTemplate);
    
    if (!textoTemplate) {
        previewContainer.style.display = 'none';
        return;
    }
    
    let previewTexto = textoTemplate;
    let indiceAnonimo = 0;
    
    // Substitui placeholders
    placeholders.forEach(placeholder => {
        const valor = placeholderValues[placeholder.nome] || '';
        
        if (placeholder.tipo === 'nomeado') {
            // Substitui placeholders nomeados
            const textoComValor = valor || `[${placeholder.nome}]`;
            previewTexto = previewTexto.replace(placeholder.padrao, textoComValor);
        } else {
            // Para anônimos, substitui sequencialmente
            const textoComValor = valor || `[variável ${indiceAnonimo + 1}]`;
            // Substitui o primeiro {} encontrado
            previewTexto = previewTexto.replace('{}', textoComValor);
            indiceAnonimo++;
        }
    });
    
    previewText.textContent = previewTexto;
    previewContainer.style.display = 'block';
}

/**
 * Valida o número de telefone
 */
function validarTelefone(telefone) {
    // Remove caracteres não numéricos
    const telefoneLimpo = telefone.replace(/\D/g, '');
    
    // Validação: mínimo 10 dígitos (DDD + número), máximo 15 dígitos (incluindo código do país)
    if (telefoneLimpo.length < 10 || telefoneLimpo.length > 15) {
        return {
            valido: false,
            mensagem: 'Telefone deve ter entre 10 e 15 dígitos'
        };
    }
    
    return {
        valido: true,
        telefone: telefoneLimpo
    };
}

/**
 * Verifica se todos os campos estão preenchidos e habilita/desabilita o botão
 */
function verificarHabilitacaoBotao() {
    const telefoneValido = validarTelefone(telefoneInput.value);
    const templateSelecionado = currentTemplate !== null;
    
    // Atualiza mensagem de erro do telefone
    const telefoneGroup = telefoneInput.closest('.form-group');
    let errorMsg = telefoneGroup.querySelector('.error-message');
    
    if (telefoneInput.value.trim() && !telefoneValido.valido) {
        if (!errorMsg) {
            errorMsg = document.createElement('div');
            errorMsg.className = 'error-message';
            telefoneGroup.appendChild(errorMsg);
        }
        errorMsg.textContent = telefoneValido.mensagem;
        telefoneInput.classList.add('error');
    } else {
        if (errorMsg) {
            errorMsg.remove();
        }
        telefoneInput.classList.remove('error');
    }
    
    let todosCamposPreenchidos = true;
    
    if (placeholders.length > 0) {
        todosCamposPreenchidos = placeholders.every(placeholder => {
            const valor = placeholderValues[placeholder.nome];
            return valor && valor.trim().length > 0;
        });
    }
    
    dispararBtn.disabled = !(telefoneValido.valido && telefoneInput.value.trim() && templateSelecionado && todosCamposPreenchidos);
}

/**
 * Configura event listeners
 */
function setupEventListeners() {
    templateSelect.addEventListener('change', processarTemplateSelecionado);
    
    // Valida telefone e verifica botão em tempo real
    telefoneInput.addEventListener('input', () => {
        verificarHabilitacaoBotao();
    });
    
    // Blur para mostrar erro se necessário
    telefoneInput.addEventListener('blur', () => {
        verificarHabilitacaoBotao();
    });
    
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await dispararMensagem();
    });
}

/**
 * Dispara a mensagem via API 360dialog
 */
async function dispararMensagem() {
    try {
        dispararBtn.disabled = true;
        showStatus('Enviando mensagem...', 'info');
        
        const apiKey = getApiKeyFromRocketChat() || API_CONFIG.apiKey;
        const instanceId = getInstanceIdFromRocketChat() || API_CONFIG.instanceId;
        const modoTeste = API_CONFIG.modoTeste || !apiKey || !instanceId;
        
        const telefone = telefoneInput.value.trim().replace(/\D/g, ''); // Remove caracteres não numéricos
        
        // Prepara os parâmetros do template
        const parameters = placeholders.map(placeholder => ({
            type: 'text',
            text: placeholderValues[placeholder.nome] || ''
        }));
        
        // Monta o payload da API 360dialog
        const payload = {
            messaging_product: 'whatsapp',
            to: telefone,
            type: 'template',
            template: {
                name: currentTemplate.name,
                language: {
                    code: currentTemplate.language || 'pt_BR'
                },
                components: [
                    {
                        type: 'body',
                        parameters: parameters
                    }
                ]
            }
        };
        
        // Modo teste: simula o envio
        if (modoTeste) {
            console.log('=== MODO TESTE - Simulação de envio ===');
            console.log('Telefone:', telefone);
            console.log('Template:', currentTemplate.name);
            console.log('Payload:', JSON.stringify(payload, null, 2));
            console.log('Mensagem final:', previewText.textContent);
            console.log('========================================');
            
            // Simula um delay de envio
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            showStatus('✅ MODO TESTE: Mensagem simulada com sucesso! (Verifique o console)', 'success');
            
            // Limpa o formulário após sucesso
            setTimeout(() => {
                resetarFormulario();
            }, 3000);
            
            return;
        }
        
        // Modo produção: envia realmente
        const response = await fetch(`${API_CONFIG.baseUrl}/messages?instance_id=${instanceId}`, {
            method: 'POST',
            headers: {
                'D360-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Erro ao enviar mensagem: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('Resposta da API:', result);
        
        showStatus('Mensagem enviada com sucesso!', 'success');
        
        // Limpa o formulário após sucesso
        setTimeout(() => {
            resetarFormulario();
        }, 2000);
        
    } catch (error) {
        console.error('Erro ao disparar mensagem:', error);
        showStatus(`Erro ao enviar mensagem: ${error.message}`, 'error');
        dispararBtn.disabled = false;
        verificarHabilitacaoBotao();
    }
}

/**
 * Reseta o formulário
 */
function resetarFormulario() {
    telefoneInput.value = '';
    telefoneInput.classList.remove('error');
    const telefoneGroup = telefoneInput.closest('.form-group');
    const errorMsg = telefoneGroup.querySelector('.error-message');
    if (errorMsg) errorMsg.remove();
    
    templateSelect.selectedIndex = 0;
    currentTemplate = null;
    placeholders = [];
    placeholderValues = {};
    ocultarCamposDinamicos();
    previewContainer.style.display = 'none';
    document.getElementById('template-text-container')?.remove();
    dispararBtn.disabled = true;
    showStatus('', '');
}

/**
 * Mostra mensagens de status
 */
function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = message ? 'block' : 'none';
}

/**
 * Função para obter API Key do Rocket.Chat
 * Você pode implementar isso usando window.parent.postMessage ou outras formas de comunicação
 */
function getApiKeyFromRocketChat() {
    // Opção 1: Via URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const apiKey = urlParams.get('api_key');
    if (apiKey) return apiKey;
    
    // Opção 2: Via localStorage (se configurado no Rocket.Chat)
    const storedApiKey = localStorage.getItem('360dialog_api_key');
    if (storedApiKey) return storedApiKey;
    
    // Opção 3: Via window.parent (comunicação com Rocket.Chat)
    try {
        if (window.parent && window.parent !== window) {
            // Comunicação com iframe parent
            // window.parent.postMessage({ type: 'get_api_key' }, '*');
        }
    } catch (e) {
        console.warn('Não foi possível acessar window.parent:', e);
    }
    
    return null;
}

/**
 * Função para obter Instance ID do Rocket.Chat
 */
function getInstanceIdFromRocketChat() {
    // Opção 1: Via URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const instanceId = urlParams.get('instance_id');
    if (instanceId) return instanceId;
    
    // Opção 2: Via localStorage
    const storedInstanceId = localStorage.getItem('360dialog_instance_id');
    if (storedInstanceId) return storedInstanceId;
    
    return null;
}

// Permite configuração manual das credenciais (útil para desenvolvimento)
window.configurar360Dialog = function(apiKey, instanceId, modoTeste = false) {
    API_CONFIG.apiKey = apiKey;
    API_CONFIG.instanceId = instanceId;
    API_CONFIG.modoTeste = modoTeste;
    localStorage.setItem('360dialog_api_key', apiKey);
    localStorage.setItem('360dialog_instance_id', instanceId);
    localStorage.setItem('360dialog_modo_teste', modoTeste ? 'true' : 'false');
    carregarTemplates();
};

// Carrega modo de teste do localStorage
if (localStorage.getItem('360dialog_modo_teste') === 'true') {
    API_CONFIG.modoTeste = true;
}
