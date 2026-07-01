// ==========================================================
// 🚀 Supabase 클라이언트 초기화 및 상태 관리
// ==========================================================
const SUPABASE_URL = "https://nsyhvjmhktverzccjukx.supabase.co"; // 본인의 URL
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zeWh2am1oa3R2ZXJ6Y2NqdWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjI2MTcsImV4cCI6MjA5NzMzODYxN30.bMOQc_ZQSWXJ_RPLIn-JHX1mu73ovvr1xi-_n2XQHFU";    // 본인의 Anon Key

// 💡 [핵심 수정] window.supabase(소문자)를 명시하여 CDN 라이브러리를 정확히 호출합니다!
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let localConfig = {
    staffs: ['철수T', '영희T'],
    presets: { 'HP': 20, 'ICT': 15, 'MW': 5 }
};
let localPatientsData = {}; // 브라우저 메모리 보관용 (DB 최적화 매핑 브릿지)
let DEFAULT_ROW_COUNT = 40;
let currentAuthMode = 'create'; 
let currentRoomId = null;   // UUID 보관용
let currentRoomName = null; // 방 이름 보관용

window.addEventListener("DOMContentLoaded", async () => {
    const savedRoom = localStorage.getItem("PT_ROOM_NAME");
    if (savedRoom) {
        successLoginBridge(savedRoom);
    }

    setInterval(updateRunningTimersOnScreen, 1000);
    
    const gridWrapper = document.querySelector(".grid-wrapper");
    if (gridWrapper) {
        gridWrapper.addEventListener("scroll", () => {
            if ((gridWrapper.scrollTop + gridWrapper.clientHeight) >= gridWrapper.scrollHeight - 20) {
                const defaultTreats = Object.keys(localConfig.presets);
                localConfig.staffs.forEach(staff => {
                    if (!localPatientsData[staff]) localPatientsData[staff] = [];
                    for (let i = 0; i < 5; i++) {
                        localPatientsData[staff].push({ 
                            name: '', 
                            timers: {}, 
                            activeTreatments: [...defaultTreats] 
                        });
                    }
                });
                DEFAULT_ROW_COUNT += 5;
                drawLocalGrid();
            }
        });
    }
});

// ==========================================================
// 🔓 로그인 & 회원가입 & 실시간 연동 (Supabase Sync)
// ==========================================================
function showLoginSub(mode) {
    currentAuthMode = mode;
    document.getElementById("loginMainBtns").style.display = "none";
    document.getElementById("loginFormArea").style.display = "block";
    
    const formTitle = document.getElementById("formTitle");
    const btnSubmit = document.getElementById("btnSubmitForm");
    
    if (mode === 'create') {
        formTitle.innerText = "➕ 새로운 팀방 개설하기";
        btnSubmit.innerText = "방 만들기 및 접속";
        btnSubmit.style.background = "#217346";
    } else {
        formTitle.innerText = "🚪 기존 팀방 접속하기";
        btnSubmit.innerText = "팀방 입장";
        btnSubmit.style.background = "#1a73e8";
    }
}

function hideLoginSub() {
    document.getElementById("loginMainBtns").style.display = "flex";
    document.getElementById("loginFormArea").style.display = "none";
    document.getElementById("roomName").value = "";
    document.getElementById("roomPassword").value = "";
}

async function handleRoomAuth() {
    const roomName = document.getElementById("roomName").value.trim();
    const roomPassword = document.getElementById("roomPassword").value.trim();

    if (!roomName || !roomPassword) {
        alert("팀방 이름과 비밀번호를 모두 입력해 주세요.");
        return;
    }

    if (currentAuthMode === 'create') {
        const { data: existingRoom } = await supabaseClient.from('rooms').select('id').eq('room_name', roomName).maybeSingle();
        if (existingRoom) {
            alert("이미 존재하는 팀방 이름입니다. 다른 이름을 사용하거나 접속하기를 이용하세요.");
            return;
        }

        const { data: newRoom, error: createError } = await supabaseClient.from('rooms').insert([{ room_name: roomName, room_password: roomPassword }]).select().single();
        if (createError) { alert("방 생성 중 오류가 발생했습니다: " + createError.message); return; }

        await supabaseClient.from('room_configs').insert([{ room_id: newRoom.id, staffs: localConfig.staffs, presets: localConfig.presets }]);

        alert(`🎉 [${roomName}] 팀방이 성공적으로 개설되었습니다.`);
        successLoginBridge(roomName);
    } else {
        const { data: room, error } = await supabaseClient.from('rooms').select('*').eq('room_name', roomName).maybeSingle();
        if (!room) {
            alert("존재하지 않는 팀방입니다. 이름을 다시 확인하거나 새로 개설해 주세요.");
            return;
        }
        if (room.room_password !== roomPassword) {
            alert("공용 비밀번호가 일치하지 않습니다.");
            return;
        }
        alert(`🔑 [${roomName}] 팀방에 성공적으로 접속했습니다.`);
        successLoginBridge(roomName);
    }
}

async function successLoginBridge(roomName) {
    localStorage.setItem("PT_ROOM_NAME", roomName);
    currentRoomName = roomName;
    
    document.getElementById("loginSection").style.display = "none";
    document.getElementById("mainDashboard").style.display = "flex";
    document.getElementById("currentRoomLabel").innerText = roomName;
    
    const { data: room } = await supabaseClient.from('rooms').select('id').eq('room_name', roomName).single();
    currentRoomId = room.id;

    const { data: config } = await supabaseClient.from('room_configs').select('*').eq('room_id', currentRoomId).single();
    if (config) {
        localConfig.staffs = config.staffs;
        localConfig.presets = config.presets;
    }

    await loadGridFromSupabase();

    // 리얼타임 웹소켓 구독망 연동
    supabaseClient.channel('public:patients_grid')
        .on('postgres_changes', { event: '*', filter: `room_id=eq.${currentRoomId}`, schema: 'public', table: 'patients_grid' }, async (payload) => {
            await loadGridFromSupabase();
        })
        .subscribe();
}

function handleLogout() {
    if (confirm("로그아웃 하시겠습니까?")) {
        localStorage.removeItem("PT_ROOM_NAME");
        location.reload();
    }
}

// ==========================================================
// 📊 격자 데이터 최적화 로딩 및 원격 동기화 엔진
// ==========================================================
async function loadGridFromSupabase() {
    const { data: dbRows } = await supabaseClient.from('patients_grid').select('*').eq('room_id', currentRoomId);
    
    localPatientsData = {};
    const defaultTreats = Object.keys(localConfig.presets);
    
    localConfig.staffs.forEach(staff => {
        localPatientsData[staff] = [];
        for (let i = 0; i < DEFAULT_ROW_COUNT; i++) {
            localPatientsData[staff].push({ name: '', timers: {}, activeTreatments: [...defaultTreats] });
        }
    });

    if (dbRows) {
        dbRows.forEach(item => {
            if (localPatientsData[item.staff_name] && localPatientsData[item.staff_name][item.row_index]) {
                localPatientsData[item.staff_name][item.row_index] = {
                    name: item.patient_name,
                    timers: item.timers,
                    activeTreatments: item.active_treatments
                };
            }
        });
    }
    drawLocalGrid();
}

function initLocalData() {
    const defaultTreats = Object.keys(localConfig.presets);
    localConfig.staffs.forEach(staff => {
        if (!localPatientsData[staff]) {
            localPatientsData[staff] = [];
            for (let i = 0; i < DEFAULT_ROW_COUNT; i++) {
                localPatientsData[staff].push({ name: '', timers: {}, activeTreatments: [...defaultTreats] });
            }
        } else {
            localPatientsData[staff].forEach(p => {
                if (!p.name || p.name.trim() === "") {
                    p.activeTreatments = [...defaultTreats];
                    p.timers = {};
                }
            });
        }
    });
}

function drawLocalGrid() {
    const headerRow = document.getElementById("excelHeaderRow");
    const subHeaderRow = document.getElementById("excelSubHeaderRow");
    const gridBody = document.getElementById("excelBody");
    if (!headerRow || !subHeaderRow || !gridBody) return;

    headerRow.innerHTML = `<div class="cell-number"></div>`;
    subHeaderRow.innerHTML = `<div class="cell-number"></div>`;
    gridBody.innerHTML = "";

    localConfig.staffs.forEach(staff => {
        headerRow.innerHTML += `<div class="cell-master-header">${staff}</div>`;
        subHeaderRow.innerHTML += `
            <div class="cell-patient sub-label">환자이름 / 방 번호</div>
            <div class="cell-treatment sub-label">치료</div>
        `;
    });

    const timerEnabledList = Object.keys(localConfig.presets);

    for (let rowIndex = 0; rowIndex < DEFAULT_ROW_COUNT; rowIndex++) {
        const rowDiv = document.createElement("div");
        rowDiv.className = "excel-data-row";
        let rowHTML = `<div class="cell-number">${rowIndex + 1}</div>`;

        localConfig.staffs.forEach(staff => {
            const patient = localPatientsData[staff][rowIndex] || { name: "", activeTreatments: [], timers: {} };
            const defaultTreats = Object.keys(localConfig.presets);
            const activeTreatments = patient.activeTreatments && patient.activeTreatments.length > 0 ? patient.activeTreatments : [...defaultTreats];
            
            let isPatientAllDone = false;
            if (patient.name && patient.name.trim() !== "") {
                let doneCount = 0;
                activeTreatments.forEach(t => { if (patient.timers[t] === "done") doneCount++; });
                
                if (activeTreatments.length > 0 && doneCount === activeTreatments.length) {
                    isPatientAllDone = true;
                }
            }

            let btnGroupHTML = `<div class="treatment-box-group">`;
            if (patient.name && patient.name.trim() !== "") {
                btnGroupHTML += `<button onclick="openTreatConfig('${staff}', ${rowIndex})" style="margin-right:5px; cursor:pointer; background:none; border:none; font-size:11px;">⚙️</button>`;
                
                activeTreatments.forEach(treat => {
                    const timerVal = patient.timers[treat];
                    let btnClass = "btn-action-cell";
                    let btnText = treat;
                    let btnStyle = "";

                    if (timerVal === "done") {
                        btnClass += " active-done";
                    } else if (timerVal) {
                        btnClass += " running";

                        const startTime = new Date(timerVal);
                        const now = new Date();
                        const elapsedSeconds = Math.floor((now - startTime) / 1000);
                        const limitMinutes = localConfig.presets[treat] || 20;
                        const remainingSeconds = (limitMinutes * 60) - elapsedSeconds;

                        if (remainingSeconds <= 0) {
                            btnText = `${treat} 종료!!`;
                            btnStyle = `style="background: #fce4d6; color: #c00000;"`;
                        } else {
                            if (timerEnabledList.includes(treat)) {
                                const min = Math.floor(remainingSeconds / 60);
                                const sec = remainingSeconds % 60;
                                btnText = `${treat} ${min}:${sec < 10 ? "0" + sec : sec}`;
                            } else {
                                btnText = treat;
                            }
                        }
                    }

                    btnGroupHTML += `
                        <button class="${btnClass}" ${btnStyle}
                                data-staff="${staff}" data-row-index="${rowIndex}" data-treat-type="${treat}" data-start-time="${timerVal || ''}"
                                onclick="handleLocalTimerClick('${staff}', ${rowIndex}, '${treat}', '${timerVal || ''}')">${btnText}</button>
                    `;
                });
            }
            btnGroupHTML += `</div>`;

            const doneClass = isPatientAllDone ? " individual-done" : "";

            rowHTML += `
                <div class="cell-patient${doneClass}">
                    <input type="text" class="input-patient-cell" value="${patient.name || ''}" placeholder="-"
                           onchange="syncPatientRowToSupabase('${staff}', ${rowIndex}, this.value)" oninput="handleNameInput('${staff}', ${rowIndex}, this)">
                </div>
                <div class="cell-treatment${doneClass}">${btnGroupHTML}</div>
            `;
        });

        rowDiv.innerHTML = rowHTML;
        gridBody.appendChild(rowDiv);
    }
}

function handleNameInput(staff, rowIndex, inputEl) {
    if (localPatientsData[staff] && localPatientsData[staff][rowIndex]) {
        localPatientsData[staff][rowIndex].name = inputEl.value;
    }
}

async function syncPatientRowToSupabase(staff, rowIndex, newValue) {
    const trimmedVal = newValue.trim();
    if (localPatientsData[staff] && localPatientsData[staff][rowIndex]) {
        localPatientsData[staff][rowIndex].name = trimmedVal;
    }

    if (!trimmedVal) {
        await supabaseClient.from('patients_grid').delete().eq('room_id', currentRoomId).eq('staff_name', staff).eq('row_index', rowIndex);
    } else {
        const p = localPatientsData[staff][rowIndex];
        await supabaseClient.from('patients_grid').upsert({
            room_id: currentRoomId,
            staff_name: staff,
            row_index: rowIndex,
            patient_name: trimmedVal,
            active_treatments: p.activeTreatments,
            timers: p.timers
        }, { onConflict: 'room_id,staff_name,row_index' });
    }
    drawLocalGrid();
}

async function handleLocalTimerClick(staff, rowIndex, treatType, currentVal) {
    let patient = localPatientsData[staff][rowIndex]; 
    if (!patient) return;

    if (!currentVal || currentVal === 'null' || currentVal === 'undefined' || currentVal === '') {
        patient.timers[treatType] = new Date().toISOString();
    } else if (currentVal === "done") {
        patient.timers[treatType] = null;
    } else {
        patient.timers[treatType] = "done";
    }

    await supabaseClient.from('patients_grid').upsert({
        room_id: currentRoomId,
        staff_name: staff,
        row_index: rowIndex,
        patient_name: patient.name,
        active_treatments: patient.activeTreatments,
        timers: patient.timers
    }, { onConflict: 'room_id,staff_name,row_index' });

    drawLocalGrid();
}

function updateRunningTimersOnScreen() {
    const runningButtons = document.querySelectorAll(".btn-action-cell.running");
    const timerEnabledList = Object.keys(localConfig.presets); 
    
    runningButtons.forEach(btn => {
        const startTimeStr = btn.getAttribute("data-start-time");
        const treatType = btn.getAttribute("data-treat-type");
        if (!startTimeStr || startTimeStr === "done") return;
        const startTime = new Date(startTimeStr);
        const now = new Date();
        const elapsedSeconds = Math.floor((now - startTime) / 1000);
        
        const limitMinutes = localConfig.presets[treatType] || 20;
        const remainingSeconds = (limitMinutes * 60) - elapsedSeconds;

        if (remainingSeconds <= 0) {
            btn.innerText = `${treatType} 종료!!`; 
            btn.style.background = "#fce4d6"; 
            btn.style.color = "#c00000";
        } else {
            if (timerEnabledList.includes(treatType)) {
                const min = Math.floor(remainingSeconds / 60); 
                const sec = remainingSeconds % 60;
                btn.innerText = `${treatType} ${min}:${sec < 10 ? "0" + sec : sec}`;
            } else { 
                btn.innerText = treatType; 
            }
        }
    });
}

// ==========================================================
// 🛠️ 환경 설정 (치료사 및 마스터 프리셋) 동기화
// ==========================================================
function openSetupModal() { document.getElementById("setupModal").style.display = "flex"; drawSetupTags(); }
function closeSetupModal() { document.getElementById("setupModal").style.display = "none"; }
function drawSetupTags() {
    const staffBucket = document.getElementById("staffTagList");
    if (staffBucket) {
        staffBucket.innerHTML = "";
        localConfig.staffs.forEach((s, idx) => { staffBucket.innerHTML += `<span class="tag-chip">${s}<span class="remove-tag" onclick="removeLocalStaff(${idx})">✕</span></span>`; });
    }
    const treatBucket = document.getElementById("treatmentTagList");
    if (treatBucket) {
        treatBucket.innerHTML = "";
        Object.entries(localConfig.presets).forEach(([treat, min]) => { treatBucket.innerHTML += `<span class="tag-chip">${treat} (${min}분)<span class="remove-tag" onclick="removeLocalPreset('${treat}')">✕</span></span>`; });
    }
}
function addStaffTag() {
    const input = document.getElementById("inputStaffName"); const val = input.value.trim();
    if (val && !localConfig.staffs.includes(val)) { localConfig.staffs.push(val); input.value = ""; drawSetupTags(); }
}
function addTreatmentPreset() {
    const nameInput = document.getElementById("inputTreatName"); const minInput = document.getElementById("inputTreatMin");
    const name = nameInput.value.trim().toUpperCase(); const min = parseInt(minInput.value) || 10;
    if (name) { localConfig.presets[name] = min; nameInput.value = ""; minInput.value = ""; drawSetupTags(); }
}
function removeLocalStaff(idx) { 
    const staffName = localConfig.staffs[idx]; 
    localConfig.staffs.splice(idx, 1); 
    delete localPatientsData[staffName]; 
    drawSetupTags(); 
}
function removeLocalPreset(key) { delete localConfig.presets[key]; drawSetupTags(); }

async function applySettingsLocal() {
    initLocalData();
    if (currentRoomId) {
        await supabaseClient.from('room_configs').upsert({
            room_id: currentRoomId,
            staffs: localConfig.staffs,
            presets: localConfig.presets
        });
    }
    drawLocalGrid();
    closeSetupModal();
}

// ==========================================================
// ⚙️ 개별 치료 항목 모달 매핑 제어부 (하드코딩 제거 및 기능 추가)
// ==========================================================
let currentTarget = { staff: '', index: 0 };

/**
 * 1. [기능] 기본 치료 항목과 사용자가 추가한 치료 항목을 병합하여 가져오는 함수
 */
function getIndividualOptions() {
    const defaultOptions = ['HP', 'ICT', 'MW', '자기장', 'CRYO', 'ESWT', '도수', '견인(목)', '견인(허리)', 'CPM', '얼음팩'];
    const savedOptions = JSON.parse(localStorage.getItem('CUSTOM_INDIVIDUAL_TREATMENTS')) || [];
    // 중복 제거 후 하나의 배열로 합침
    return [...new Set([...defaultOptions, ...savedOptions])];
}

/**
 * 2. [기능] 모달 내 체크박스 전체 해제 기능 (HP 위에 위치할 버튼용)
 */
function deselectAllIndividualTreatments() {
    const allOptions = getIndividualOptions();
    allOptions.forEach(opt => {
        const chk = document.getElementById(`check-${opt}`);
        if (chk) chk.checked = false;
    });
}

/**
 * 3. [기능] 모달 좌측 하단 "치료추가" 버튼 클릭 시 작동하는 함수
 */
function addIndividualTreatment() {
    const newTreat = prompt("우리 병원에 맞는 새로운 치료 항목을 입력하세요:");
    if (!newTreat || newTreat.trim() === "") return;
    const cleanName = newTreat.trim();
    
    const currentOptions = getIndividualOptions();
    if (currentOptions.includes(cleanName)) {
        alert("이미 존재하는 치료 항목입니다.");
        return;
    }
    
    // 로컬 스토리지에 추가 항목 저장
    const savedOptions = JSON.parse(localStorage.getItem('CUSTOM_INDIVIDUAL_TREATMENTS')) || [];
    savedOptions.push(cleanName);
    localStorage.setItem('CUSTOM_INDIVIDUAL_TREATMENTS', JSON.stringify(savedOptions));
    
    // 새로 추가할 때 기존에 사용자가 모달에서 체크해 두었던 상태를 유지하기 위해 현재 체크된 항목 수집
    const allOptions = getIndividualOptions();
    const checkedOptions = allOptions.filter(opt => {
        const chk = document.getElementById(`check-${opt}`);
        return chk ? chk.checked : false;
    });
    // 방금 추가한 치료 항목도 자동으로 체크 상태로 만듦
    checkedOptions.push(cleanName);
    
    // 리스트 다시 그리기
    renderIndividualTreatList(checkedOptions);
}

/**
 * 4. [기능] 동적 치료 리스트 및 상단 '전체 해제' 버튼을 화면에 그려주는 함수
 */
function renderIndividualTreatList(activeList) {
    const list = document.getElementById('treatConfigList');
    if (!list) return;

    const allOptions = getIndividualOptions();
    
    // HP 버튼 윗줄에 '전체 해제' 버튼 디자인 레이아웃 추가
    let html = `
        <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee; text-align: left;">
            <button type="button" onclick="deselectAllIndividualTreatments()" style="background: #f44336; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">🔓 전체 해제</button>
        </div>
    `;
    
    // 동적 항목 렌더링
    html += allOptions.map(opt => `
        <div style="margin-bottom: 6px;">
            <input type="checkbox" id="check-${opt}" ${activeList.includes(opt) ? 'checked' : ''}>
            <label for="check-${opt}" style="margin-left: 5px; cursor:pointer; user-select: none;">${opt}</label>
        </div>
    `).join('');
    
    list.innerHTML = html;
}

/**
 * 5. [수정] 모달 열기 함수 (하드코딩 제거 및 동적 렌더링 연동)
 */
function openTreatConfig(staff, index) {
    currentTarget = { staff, index }; 
    const patient = localPatientsData[staff][index];
    
    const defaultTreats = Object.keys(localConfig.presets);
    const active = patient.activeTreatments && patient.activeTreatments.length > 0 ? patient.activeTreatments : [...defaultTreats];
    
    // 화면 그리기 함수 호출
    renderIndividualTreatList(active);
    
    document.getElementById('treatConfigModal').style.display = 'flex';
}

/**
 * 6. [수정] 선택 적용 저장 함수 (하드코딩 제거 및 동적 배열 연동)
 */
async function saveTreatConfig() {
    const allOptions = getIndividualOptions(); // 동적으로 현재 리스트 가져오기
    const newActive = allOptions.filter(opt => { 
        const chk = document.getElementById(`check-${opt}`); 
        return chk ? chk.checked : false; 
    });
    
    if (localPatientsData[currentTarget.staff] && localPatientsData[currentTarget.staff][currentTarget.index]) {
        localPatientsData[currentTarget.staff][currentTarget.index].activeTreatments = newActive;
        
        const p = localPatientsData[currentTarget.staff][currentTarget.index];
        await supabaseClient.from('patients_grid').upsert({
            room_id: currentRoomId,
            staff_name: currentTarget.staff,
            row_index: currentTarget.index,
            patient_name: p.name,
            active_treatments: p.activeTreatments,
            timers: p.timers
        }, { onConflict: 'room_id,staff_name,row_index' });
    }
    
    drawLocalGrid(); 
    document.getElementById('treatConfigModal').style.display = 'none';
}

function closeTreatConfigModal() { document.getElementById('treatConfigModal').style.display = 'none'; }

// ==========================================================
// 🧼 하루 일과 마감 - Supabase DB 및 화면 일괄 초기화 (최종 수정본)
// ==========================================================
async function triggerResetAllPatients() {
    
    // 🔒 [안전장치 1차] 요청하신 1차 검증 멘트
    if (!confirm("🚨 정말로 초기화 하시겠습니까?")) {
        return; // '취소' 클릭 시 즉시 중단
    }

    // 🔒 [안전장치 2차] 이중 방어 확인 멘트
    if (!confirm("⚠️ 이 작업은 되돌릴 수 없습니다.\n오늘 등록된 모든 환자 이름과 치료 완료 기록이 삭제됩니다. 정말 진행하시겠습니까?")) {
        return; // '취소' 클릭 시 즉시 중단
    }

    try {
        // 💡 [원격 DB 초기화] 현재 방(room_id)에 생성된 모든 환자 행 데이터를 완전히 비웁니다.
        // 기존 기획(이름 없으면 delete) 구조와 매칭되어 빈 더미 데이터가 쌓이지 않도록 깔끔하게 delete 처리합니다.
        const { error } = await supabaseClient
            .from('patients_grid')
            .delete()
            .eq('room_id', currentRoomId);

        if (error) throw error;

        // 원격 DB 삭제가 완료되면, 내 화면 및 로컬 변수 데이터를 새로고침합니다.
        if (typeof loadGridFromSupabase === "function") {
            await loadGridFromSupabase();
        } else {
            // 예외 방어용 로컬 강제 리셋 로직
            localConfig.staffs.forEach(staff => {
                for (let i = 0; i < DEFAULT_ROW_COUNT; i++) {
                    if (localPatientsData[staff] && localPatientsData[staff][i]) {
                        localPatientsData[staff][i].name = "";
                        localPatientsData[staff][i].timers = {};
                    }
                }
            });
            drawLocalGrid();
        }

        // 초기화 성공 시 환경설정 팝업창을 닫아줍니다.
        if (typeof closeSetupModal === "function") {
            closeSetupModal();
        }

        alert("🧹 환자 데이터 초기화가 완료되었습니다!");

    } catch (err) {
        console.error("초기화 오류 발생:", err);
        alert("❌ DB 초기화에 실패했습니다. 인터넷 연결 상태나 Supabase 설정을 확인해 주세요.");
    }
}
// ==========================================================
// 📊 오늘 최종 기록 엑셀(CSV) 다운로드 엔진
// ==========================================================
function exportToCSV() {
    if (!localConfig.staffs || localConfig.staffs.length === 0) {
        alert("출력할 치료사 데이터가 없습니다.");
        return;
    }

    // 1. 한국어 깨짐 방지를 위한 UTF-8 BOM 설정 (엑셀에서 바로 열 때 필수)
    let csvContent = "\uFEFF"; 

    // 2. 엑셀 첫 번째 줄 생성 (치료사 이름 라인업)
    let row1 = ["순번"];
    localConfig.staffs.forEach(staff => {
        row1.push(staff, ""); // 환자이름 칸, 치료 현황 칸 (2칸 확보)
    });
    csvContent += row1.join(",") + "\n";

    // 3. 엑셀 두 번째 줄 생성 (서브 헤더)
    let row2 = [""];
    localConfig.staffs.forEach(() => {
        row2.push("환자이름 / 방 번호", "치료 현황");
    });
    csvContent += row2.join(",") + "\n";

    // 4. 데이터가 존재하는 마지막 행(Row) 탐색 (뒤쪽에 환자가 없는 빈 행들은 수출에서 제외하여 깔끔하게 처리)
    let lastActiveRowIndex = 0;
    for (let rowIndex = 0; rowIndex < DEFAULT_ROW_COUNT; rowIndex++) {
        localConfig.staffs.forEach(staff => {
            const patient = localPatientsData[staff]?.[rowIndex];
            if (patient && patient.name && patient.name.trim() !== "") {
                lastActiveRowIndex = rowIndex; // 마지막으로 환자가 작성된 줄 기억
            }
        });
    }

    // 5. 실제 데이터 변환 및 결합 루프 (첫 줄부터 마지막 활성화 줄까지)
    for (let rowIndex = 0; rowIndex <= lastActiveRowIndex; rowIndex++) {
        let rowData = [rowIndex + 1]; // 순번 입력 (1, 2, 3...)

        localConfig.staffs.forEach(staff => {
            const patient = localPatientsData[staff]?.[rowIndex] || { name: "", activeTreatments: [], timers: {} };
            
            // 쉼표(,) 입력 시 엑셀 셀이 찢어지는 현상 방지
            const pName = patient.name ? patient.name.replace(/,/g, " ") : ""; 

            // 치료 현황 문자열 가공 예시: "HP(완료) | ICT(진행중) | MW(대기)"
            let treatSummary = [];
            if (pName && patient.activeTreatments && patient.activeTreatments.length > 0) {
                patient.activeTreatments.forEach(treat => {
                    const timerVal = patient.timers[treat];
                    if (timerVal === "done") {
                        treatSummary.push(`${treat}(완료)`);
                    } else if (timerVal) {
                        treatSummary.push(`${treat}(진행중)`);
                    } else {
                        treatSummary.push(`${treat}(대기)`);
                    }
                });
            }
            const treatStr = treatSummary.join(" | ");

            // CSV 규칙에 맞게 따옴표로 감싸서 행 배열에 추가
            rowData.push(`"${pName}"`, `"${treatStr}"`);
        });

        // 한 줄 완성 후 CSV 텍스트 변환
        csvContent += rowData.join(",") + "\n";
    }

    // 6. 브라우저 강제 다운로드 트리거 실행
    const today = new Date().toISOString().split('T')[0]; // 오늘 날짜 (YYYY-MM-DD)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `물리치료실_현황판_${today}.csv`); // 파일명 자동 세팅
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}