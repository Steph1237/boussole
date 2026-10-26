#!/usr/bin/env python3
"""Vérification indépendante du scénario locatif_scpi (spec 2026-10-26, § 3).
Calcul mois par mois, déterministe (volatilités nulles). N'utilise pas le module JS."""
import json, math, datetime

TODAY = datetime.date(2026, 10, 15)
PI = 0.02
FA_ANCIEN, FA_NEUF = 0.08, 0.025  # neuf non utilisé ici
GARANTIE, FRAIS_DOSSIER, ASS_PCT = 0.01, 1000.0, 0.003
PS_FONCIER, PS_BIC = 0.172, 0.186
MICRO_FONCIER_PLAF, MICRO_FONCIER_ABAT = 15000, 0.30
MICRO_BIC_PLAF, MICRO_BIC_ABAT = 77700, 0.50
DEF_FONC_PLAF, REPORT_ANS = 10700, 10
TERRAIN, DUR_BATI, DUR_TRAV, DUR_MOB = 0.15, 30, 10, 7
REVENTE = 0.05
JOUISSANCE = 4
AV_ABATT, AV_IR, PS_PV = 9200, 0.075, 0.172

def date_t(t):
    m = TODAY.month - 1 + t
    return datetime.date(TODAY.year + m // 12, m % 12 + 1, TODAY.day)

def g_livret(t):
    taux = 0.017 if date_t(t) <= datetime.date(2027, 1, 31) else 0.015
    return (1 + taux) ** (1 / 12)

def abatt_ir(n):
    if n < 6: return 0.0
    if n <= 21: return (n - 5) * 0.06
    return 1.0

def abatt_ps(n):
    if n < 6: return 0.0
    if n <= 21: return (n - 5) * 0.0165
    if n == 22: return 16 * 0.0165 + 0.016
    if n < 30: return 16 * 0.0165 + 0.016 + (n - 22) * 0.09
    return 1.0

def impot_pv_immo(gain, ans):
    if gain <= 0: return 0.0
    return gain * (1 - abatt_ir(ans)) * 0.19 + gain * (1 - abatt_ps(ans)) * PS_PV

def credit(C, taux, n):
    """Retourne listes (index 1..n) : echeance, interets, principal, crd_apres, assurance."""
    i = taux / 12
    ech = C * i / (1 - (1 + i) ** -n) if C > 0 else 0.0
    E, I, P, CRD, A = [0.0] * (n + 1), [0.0] * (n + 1), [0.0] * (n + 1), [C] + [0.0] * n, [0.0] * (n + 1)
    crd = C
    for t in range(1, n + 1):
        it = crd * i
        pr = crd if t == n else ech - it
        E[t], I[t], P[t] = it + pr, it, pr
        crd -= pr
        CRD[t] = crd
        A[t] = C * ASS_PCT / 12 if C > 0 else 0.0
    return ech, E, I, P, CRD, A

def run(case):
    p = dict(case)
    tmi = p['tmi']; H = p['horizon']; T = 12 * H
    reg = p['regime']; meuble = reg.startswith('lmnp')
    prix, trav = p['prix'], p['travaux']
    mob = p['mobilier'] if meuble else 0.0
    FA = prix * FA_ANCIEN
    K = prix + FA + trav + mob
    B = max(0.0, K - p['apport'])
    C = (B + FRAIS_DOSSIER) / (1 - GARANTIE) if B > 0 else 0.0
    A0 = min(p['apport'], K)
    E1 = FRAIS_DOSSIER + GARANTIE * C if C > 0 else 0.0
    n = 12 * p['duree']
    ech, ECH, INT, PRI, CRD, ASS = credit(C, p['taux'], n)
    def cr(arr, t): return arr[t] if 1 <= t <= n else 0.0
    def crd_at(t): return CRD[min(t, n)] if C > 0 else 0.0

    # Flux mensuels du bien
    Lo, Ch = [0.0] * (T + 1), [0.0] * (T + 1)
    for t in range(1, T + 1):
        y = math.ceil(t / 12)
        Lo[t] = p['loyer'] * (1 + PI) ** (y - 1) * (12 - p['vacance']) / 12
        Ch[t] = p['charges'] / 12 * (1 + PI) ** (y - 1) + p['gestion'] * Lo[t]
    # Impôt annuel
    years = {}
    deficits = []  # [annee_creation, montant]
    stock = {'bati': 0.0, 'trav': 0.0, 'mob': 0.0}
    amort_bt_cum = 0.0
    for y in range(1, H + 1):
        ms = range(12 * (y - 1) + 1, 12 * y + 1)
        R = sum(Lo[t] for t in ms); D = sum(Ch[t] for t in ms)
        J = sum(cr(INT, t) + cr(ASS, t) for t in ms)
        deficits = [d for d in deficits if y - d[0] <= REPORT_ANS and d[1] > 1e-9]
        base = 0.0; imputRG = 0.0; amort = 0.0; impot = 0.0; note = ''
        if reg == 'nu_micro':
            if R <= MICRO_FONCIER_PLAF:
                base = R * (1 - MICRO_FONCIER_ABAT); impot = base * (tmi + PS_FONCIER)
            else:
                raise ValueError('micro-foncier au-delà du plafond non géré ici')
        elif reg == 'lmnp_micro':
            if R <= MICRO_BIC_PLAF:
                base = R * (1 - MICRO_BIC_ABAT); impot = base * (tmi + PS_BIC)
            else:
                raise ValueError('micro-BIC au-delà du plafond non géré ici')
        elif reg == 'nu_reel':
            r = R - D - J - ((trav + E1) if y == 1 else 0.0)
            if r >= 0:
                reste = r
                for d in deficits:
                    u = min(d[1], reste); d[1] -= u; reste -= u
                base = reste; impot = base * (tmi + PS_FONCIER)
            else:
                h = max(0.0, -(R - D - (trav if y == 1 else 0.0)))
                imputRG = min(h, DEF_FONC_PLAF)
                impot = -imputRG * tmi
                deficits.append([y, -r - imputRG])
        elif reg == 'lmnp_reel':
            r = R - D - J - ((FA + E1) if y == 1 else 0.0)
            dot = {'bati': prix * (1 - TERRAIN) / DUR_BATI if y <= DUR_BATI else 0.0,
                   'trav': trav / DUR_TRAV if y <= DUR_TRAV else 0.0,
                   'mob': mob / DUR_MOB if y <= DUR_MOB else 0.0}
            for k in stock: stock[k] += dot[k]
            if r < 0:
                deficits.append([y, -r])
            else:
                reste = r
                for d in deficits:
                    u = min(d[1], reste); d[1] -= u; reste -= u
                for k in ('bati', 'trav', 'mob'):
                    u = min(stock[k], reste); stock[k] -= u; reste -= u; amort += u
                    if k in ('bati', 'trav'): amort_bt_cum += u
                base = reste; impot = base * (tmi + PS_BIC)
        years[y] = dict(loyers=R, charges=D, interets_assurance=J, base_imposable=base,
                        impot=impot, imputation_revenu_global=imputRG, amortissements_deduits=amort)

    # Boucle mensuelle
    a_p = math.log(1 + p['scpi_prix_part']) / 12
    Pr = [math.exp(a_p * t) for t in range(T + 1)]
    fs, td = p['scpi_frais'], p['scpi_dist']
    fm = 1 - (1 - p['frais_av']) ** (1 / 12)
    sc = p.get('scpi_credit', False)

    eL = [0.0] * (T + 1); CF = [0.0] * (T + 1)
    # S
    S_coh = {0: A0 / Pr[0]}; S_X = {0: A0}; S_tax = 0.0
    # AV
    AV_coh = {0: A0 / Pr[0]}; AV_vers = A0
    # SC
    SC_parts = (A0 + C) / Pr[0] if sc else 0.0
    SC_def = []; SC_tax = 0.0
    liv = {'L': 0.0, 'S': 0.0, 'AV': 0.0, 'SC': 0.0}
    sum_b = 0.0; sum_eL_y1 = 0.0; sum_impot_L = 0.0
    cf_year = {y: 0.0 for y in range(1, H + 1)}
    for t in range(1, T + 1):
        y = math.ceil(t / 12)
        cf = Lo[t] - Ch[t] - cr(ECH, t) - cr(ASS, t) - years[y]['impot'] / 12
        CF[t] = cf; cf_year[y] += cf
        e = max(0.0, -cf); sL = max(0.0, cf); eL[t] = e
        if y == 1: sum_eL_y1 += e
        # SC
        eSC = 0.0; sSC = 0.0
        if sc:
            dist = SC_parts * Pr[t - 1] * td / 12 if t >= JOUISSANCE + 1 else 0.0
            res = dist - cr(INT, t) - cr(ASS, t)
            SC_def = [d for d in SC_def if t - d[0] <= 12 * REPORT_ANS and d[1] > 1e-9]
            tax = 0.0
            if res < 0:
                SC_def.append([t, -res])
            else:
                reste = res
                for d in SC_def:
                    u = min(d[1], reste); d[1] -= u; reste -= u
                tax = reste * (tmi + PS_FONCIER)
            SC_tax += tax
            cfsc = dist - tax - cr(ECH, t) - cr(ASS, t)
            eSC = max(0.0, -cfsc); sSC = max(0.0, cfsc)
        b = max(e, eSC); sum_b += b
        # S direct
        jou = sum(q for u, q in S_coh.items() if u + JOUISSANCE + 1 <= t)
        dS = jou * Pr[t - 1] * td / 12
        taxS = dS * (tmi + PS_FONCIER); S_tax += taxS
        netS = dS - taxS
        X = e + (netS if p['scpi_reinvestir'] else 0.0)
        if X > 0:
            S_coh[t] = X / Pr[t]; S_X[t] = X
        # AV
        jouAV = sum(q for u, q in AV_coh.items() if u + JOUISSANCE + 1 <= t)
        dAV = jouAV * Pr[t - 1] * td / 12
        for u in AV_coh: AV_coh[u] *= (1 - fm)
        newp = e / Pr[t] + dAV / (Pr[t] * (1 - fs))
        if newp > 0: AV_coh[t] = AV_coh.get(t, 0.0) + newp
        AV_vers += e
        # Livrets
        g = g_livret(t)
        liv['L'] = liv['L'] * g + (b - e + sL)
        liv['S'] = liv['S'] * g + (b - e + (0.0 if p['scpi_reinvestir'] else netS))
        liv['AV'] = liv['AV'] * g + (b - e)
        liv['SC'] = liv['SC'] * g + (b - eSC + sSC)
        sum_impot_L += years[y]['impot'] / 12
    for y in years: years[y]['cash_flow'] = cf_year[y]

    infl = (1 + PI) ** (T / 12)
    out_opts = {}
    # L
    VT = prix * (1 + PI) ** (T / 12)
    cession = VT * (1 - REVENTE)
    if reg == 'lmnp_reel':
        fa_ret = 0.075 * prix
    else:
        fa_ret = max(FA, 0.075 * prix)
    trav_ret = 0.0 if reg == 'nu_reel' else trav
    if H > 5: trav_ret = max(trav_ret, 0.15 * prix)
    reint = amort_bt_cum if reg == 'lmnp_reel' else 0.0
    gainL = cession - (prix + fa_ret + trav_ret) + reint
    pvL = impot_pv_immo(gainL, H)
    netL = cession - crd_at(T) - pvL + liv['L']
    out_opts['L'] = dict(net_courants=netL, net_aujourdhui=netL / infl,
                         impots_totaux=sum_impot_L + pvL, impots_revenus=sum_impot_L,
                         V_T=VT, cession_nette=cession, plus_value_brute=gainL, impot_plus_value=pvL,
                         amortissements_bati_travaux_deduits=reint, CRD_T=crd_at(T), livret=liv['L'])
    # S
    partsS = sum(S_coh.values())
    valS = partsS * Pr[T] * (1 - fs)
    pvS = 0.0
    for u, q in S_coh.items():
        gain = q * Pr[T] * (1 - fs) - S_X[u]
        pvS += impot_pv_immo(gain, (T - u) // 12)
    netS_ = valS - pvS + liv['S']
    out_opts['S'] = dict(net_courants=netS_, net_aujourdhui=netS_ / infl,
                         impots_totaux=S_tax + pvS, impots_revenus=S_tax, impot_plus_value=pvS,
                         valeur_retrait=valS, parts=partsS, livret=liv['S'])
    # AV
    partsAV = sum(AV_coh.values())
    valAV = partsAV * Pr[T] * (1 - fs)
    G = valAV - AV_vers
    # règle légale : au-delà de 150 000 € de primes, la fraction du gain correspondante est imposée à 12,8 % ;
    # l'abattement s'impute d'abord sur la fraction à 7,5 %, puis sur celle à 12,8 % (BOFiP)
    if G > 0:
        q = min(1.0, 150000 / AV_vers) if AV_vers > 0 else 1.0
        g75, g128 = G * q, G * (1 - q)
        a75 = min(g75, AV_ABATT); a128 = min(g128, AV_ABATT - a75)
        taxAV = (g75 - a75) * AV_IR + (g128 - a128) * 0.128 + G * PS_PV
    else:
        taxAV = 0.0
    # variante informative : part des versements > 150 000 € à 12,8 %
    if G > 0 and AV_vers > 150000:
        q = 150000 / AV_vers
        ir_alt = max(0.0, G * q - AV_ABATT) * 0.075 + G * (1 - q) * 0.128
        taxAV_alt = ir_alt + G * PS_PV
    else:
        taxAV_alt = taxAV
    netAV = valAV - taxAV + liv['AV']
    out_opts['AV'] = dict(net_courants=netAV, net_aujourdhui=netAV / infl,
                          impots_totaux=taxAV, impot_sortie=taxAV, valeur=valAV, versements=AV_vers,
                          gain=G, livret=liv['AV'],
                          info_impot_si_regle_150k=taxAV_alt,
                          info_net_courants_si_regle_150k=valAV - taxAV_alt + liv['AV'])
    if sc:
        valSC = SC_parts * Pr[T] * (1 - fs)
        pvSC = impot_pv_immo(valSC - (A0 + C), H)
        netSC = valSC - crd_at(T) - pvSC + liv['SC']
        out_opts['SC'] = dict(net_courants=netSC, net_aujourdhui=netSC / infl,
                              impots_totaux=SC_tax + pvSC, impots_revenus=SC_tax, impot_plus_value=pvSC,
                              valeur_retrait=valSC, CRD_T=crd_at(T), livret=liv['SC'])
    return dict(
        id=p['id'], regime=reg,
        capital_C=C, echeance_hors_assurance=ech, assurance_mensuelle=(C * ASS_PCT / 12 if C > 0 else 0.0),
        A0=A0, K=K, frais_emprunt_E1=E1,
        bien_annees={str(y): years[y] for y in (1, 2, 3, H)},
        effort_moyen_mensuel_annee1=sum_eL_y1 / 12,
        budget_verse_total=A0 + sum_b,
        options=out_opts,
        livrets_T={k: v for k, v in liv.items() if k != 'SC' or sc},
    )

BASE = dict(prix=200000, travaux=0, mobilier=5000, apport=30000, loyer=900, charges=1850,
            regime='lmnp_reel', tmi=0.30, horizon=20, duree=20, taux=0.0327, vacance=1, gestion=0.0,
            scpi_frais=0.10, scpi_dist=0.0491, scpi_prix_part=-0.0041, scpi_reinvestir=True, frais_av=0.006)
CASES = [
    dict(BASE, id='LOC-1'),
    dict(BASE, id='LOC-2', regime='nu_micro'),
    dict(BASE, id='LOC-3', regime='nu_reel', travaux=30000, mobilier=0),
    dict(BASE, id='LOC-4', apport=260000, regime='lmnp_micro'),
    dict(BASE, id='LOC-5', scpi_credit=True),
]

def rnd(o):
    if isinstance(o, float): return round(o, 2)
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, list): return [rnd(v) for v in o]
    return o

if __name__ == '__main__':
    res = [rnd(run(c)) for c in CASES]
    txt = json.dumps(res, ensure_ascii=False, indent=2)
    print(txt)
    with open('/home/claude/boussole/scripts/verif/locatif-scpi-verif.json', 'w') as f:
        f.write(txt + '\n')
    print('\n%-6s %12s %12s %12s %12s   (euros d\'aujourd\'hui)' % ('cas', 'L', 'S', 'AV', 'SC'))
    for r in res:
        o = r['options']
        print('%-6s %12.2f %12.2f %12.2f %12s' % (r['id'], o['L']['net_aujourdhui'], o['S']['net_aujourdhui'],
              o['AV']['net_aujourdhui'], ('%.2f' % o['SC']['net_aujourdhui']) if 'SC' in o else '-'))
