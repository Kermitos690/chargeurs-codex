import { Link, useParams } from "react-router-dom";
import { PublicNav } from "@/components/public/PublicNav";
import { LiquidBackground } from "@/components/LiquidBackground";
import { formatChf, PUBLIC_PRICING } from "@/lib/publicPricing";

type LegalKind = "conditions" | "confidentialite" | "mentions-legales";

const LEGAL_VERSION = "10 août 2026 · conditions staging v1";

const TITLES: Record<LegalKind, string> = {
  conditions: "Conditions générales d'utilisation et de location",
  confidentialite: "Politique de confidentialité",
  "mentions-legales": "Mentions légales",
};

function Conditions() {
  return <>
    <h2>1. Service et formation du contrat</h2>
    <p>Chargeurs.ch permet de louer une batterie externe auprès d'une borne du réseau, puis de la restituer dans une borne compatible disposant d'un emplacement libre. Avant le paiement, le client voit le tarif, le mécanisme de garantie applicable, le plafond journalier et le montant maximal prévu en cas de non-retour. La validation du parcours de paiement vaut acceptation de la version des présentes conditions et de la politique de confidentialité enregistrée avec la location. La location devient active uniquement après confirmation serveur du paiement ou de l'autorisation requise et confirmation physique de la remise de la batterie.</p>

    <h2>2. Prix de location</h2>
    <p>Le tarif public est de {formatChf(1.9)} jusqu'à 30 minutes, {formatChf(3.9)} jusqu'à 2 heures, {formatChf(5.9)} jusqu'à 6 heures et {formatChf(PUBLIC_PRICING.dailyCap)} jusqu'à 24 heures. Après 24 heures, {formatChf(PUBLIC_PRICING.dailyCap)} s'ajoutent par période de 24 heures commencée. Le profil tarifaire applicable est figé côté serveur au début de la location.</p>

    <h2>3. Paiement et garantie</h2>
    <p>Aucune caution n'est configurée dans le pilote actuel. Tout mécanisme ultérieur de préautorisation ou de débit complémentaire devra être affiché au client et validé contractuellement avant son activation.</p>

    <h2>4. Moyens de paiement</h2>
    <p>Les moyens effectivement disponibles sont ceux affichés dans le parcours de paiement. Aucun moyen de paiement ne doit être présenté comme disponible avant son test de bout en bout.</p>

    <h2>5. Moyen de paiement enregistré et montants complémentaires</h2>
    <p>Chargeurs.ch ne reçoit ni ne stocke le numéro complet de carte. Tout moyen de paiement éventuellement enregistré, tout débit complémentaire et toute authentification doivent respecter les conditions affichées, la réglementation applicable et les règles du prestataire de paiement.</p>

    <h2>6. Retour et fin de location</h2>
    <p>Le client doit insérer correctement la batterie dans un emplacement compatible et attendre la détection du retour. La simple insertion mécanique ne suffit pas si l'identité de la batterie ou l'état du slot reste ambigu. La location se termine financièrement uniquement après la corrélation du retour, le calcul du prix et le règlement serveur. L'écran « Location terminée » et le reçu final ne sont affichés qu'une fois ces opérations confirmées.</p>

    <h2>7. Non-retour, perte ou batterie non restituée</h2>
    <p>En cas de non-retour après 72 heures, le montant total peut atteindre {formatChf(PUBLIC_PRICING.nonReturnTotal)} selon les conditions affichées lors de la location. Toute perception doit être compatible avec le moyen de paiement, le droit applicable et les exigences d'authentification.</p>

    <h2>8. Paiement, confirmation électronique et reçus</h2>
    <p>Les données de carte et de portefeuille sont collectées par Stripe Checkout sur le téléphone du client. Une page de succès de navigateur ne constitue jamais, à elle seule, une preuve de paiement, de remise de batterie ou de fin de location. Le système s'appuie sur les confirmations serveur et l'état physique de la borne. Lorsqu'une adresse email est fournie, Chargeurs.ch peut envoyer des messages transactionnels relatifs à la garantie, au début physique de la location, au retour, au règlement et au reçu. Ces messages sont nécessaires au suivi de la transaction et sont distincts de toute communication marketing.</p>

    <h2>9. Utilisation, sécurité et responsabilité du client</h2>
    <p>La batterie doit être utilisée avec un appareil compatible, conservée à l'abri de l'eau, de la chaleur excessive et des chocs, et ne doit pas être ouverte, démontée, modifiée ou utilisée de manière dangereuse. Tout incident doit être signalé rapidement avec l'identifiant de borne et le code public de location. Le client reste responsable des dommages causés intentionnellement ou par une utilisation manifestement contraire aux instructions, sous réserve du droit impératif applicable.</p>

    <h2>10. Dysfonctionnement, échec de délivrance et remboursement</h2>
    <p>Si le paiement ou l'autorisation est confirmé mais qu'aucune batterie n'est physiquement délivrée, Chargeurs.ch doit traiter la location comme un incident et non comme une location active. Selon le moyen de paiement, l'autorisation est libérée ou le montant encaissé est remboursé. Les délais bancaires de libération ou de remboursement ne sont pas contrôlés par Chargeurs.ch.</p>

    <h2>11. Support et contestation</h2>
    <p>Le support est accessible via support@chargeurs.ch et la page dédiée. Pour une contestation, le client doit si possible fournir le code public de location, la date et la borne concernée ; il ne doit jamais transmettre un numéro de carte complet, un code de sécurité ou un identifiant bancaire secret.</p>

    <h2>12. Validation juridique avant ouverture commerciale</h2>
    <p>Cette version constitue la base contractuelle du pilote staging. L'identité juridique définitive de l'exploitant, son adresse, les délais exacts de non-retour et les clauses de responsabilité doivent être complétés et validés avant l'ouverture commerciale au public. Aucune mention de cette page ne limite les droits impératifs du consommateur prévus par le droit suisse applicable.</p>
  </>;
}

function Privacy() {
  return <>
    <h2>1. Données traitées</h2>
    <p>Selon le parcours utilisé : adresse email, profil client, langue, versions des conditions acceptées, date d'acceptation, identifiants techniques, identifiant public de location, historique de locations, montants autorisés/capturés/remboursés, type de moyen de paiement, identifiants Stripe techniques, événements de borne, identité technique des batteries, incidents, demandes de support et journaux de sécurité. Chargeurs.ch ne stocke pas le numéro complet de carte, le cryptogramme ou les identifiants bancaires secrets.</p>

    <h2>2. Finalités</h2>
    <p>Fournir et sécuriser la location, demander la garantie, confirmer le paiement, piloter la délivrance, détecter le retour, calculer le prix final, effectuer une capture, une libération d'autorisation, un remboursement ou un complément contractuellement dû, envoyer les confirmations et reçus transactionnels, prévenir les abus, assister le client, maintenir les bornes, respecter les obligations comptables et défendre les droits liés à la transaction.</p>

    <h2>3. Sous-traitants et destinataires</h2>
    <p>Stripe traite les paiements et peut conserver un moyen de paiement lorsque le client choisit le parcours carte et que cette conservation est demandée pour les besoins contractuels décrits dans les conditions. Supabase héberge l'authentification, la base, les fonctions serveur et les événements applicatifs. ChargeNow reçoit les commandes et données techniques nécessaires au fonctionnement du matériel. Un prestataire d'email transactionnel peut recevoir l'adresse email, la langue et le contenu strictement nécessaire à l'envoi des confirmations et reçus. L'hébergeur web sert l'interface. Les accès internes sont limités par rôle et journalisés.</p>

    <h2>4. Données affichées sur une borne publique</h2>
    <p>Le récapitulatif affiché sur la borne est volontairement limité : durée, tarif, garantie, montants de règlement, catégorie de moyen de paiement, borne/slot de retour et référence publique. L'adresse email, le nom du client, le numéro de carte et les quatre derniers chiffres de la carte ne sont pas destinés à être affichés sur l'écran public.</p>

    <h2>5. Conservation et sécurité</h2>
    <p>Les durées de conservation dépendent de la finalité, de la prévention des abus, de la résolution des litiges et des obligations légales suisses, notamment comptables. Les secrets restent côté serveur, les tokens kiosque sont hachés en base et les communications utilisent TLS. Les identifiants Stripe techniques sont conservés uniquement dans la mesure nécessaire au règlement, au support, à la preuve et aux obligations légales. Les durées précises devront être formalisées dans la politique de conservation avant la production commerciale.</p>

    <h2>6. Communications transactionnelles et marketing</h2>
    <p>Les emails relatifs à une garantie, une location, un retour, un règlement, un reçu ou un incident servent à exécuter et documenter le service demandé. Ils ne constituent pas, à eux seuls, un consentement à recevoir des offres promotionnelles. Toute prospection marketing doit reposer sur un choix séparé lorsque le droit applicable l'exige.</p>

    <h2>7. Vos droits</h2>
    <p>Vous pouvez demander l'accès, la rectification, l'export ou la suppression des données qui ne doivent plus être conservées légalement, ainsi que des informations sur leur traitement. Connectez-vous à votre compte lorsqu'il existe ou contactez support@chargeurs.ch. Une vérification d'identité peut être demandée afin d'éviter de transmettre des données à un tiers.</p>

    <h2>8. Contact</h2>
    <p>Responsable du traitement : Chargeurs.ch, identité juridique et adresse à compléter et valider avant production commerciale. Contact opérationnel : support@chargeurs.ch.</p>
  </>;
}

function LegalNotice() {
  return <>
    <h2>Exploitant</h2><p>Chargeurs.ch. La raison sociale, la forme juridique, l'adresse du siège, le numéro IDE/TVA lorsqu'il est applicable et le représentant autorisé doivent être fournis par l'exploitant puis validés avant la mise en production commerciale.</p>
    <h2>Contact</h2><p>Email : support@chargeurs.ch. Les coordonnées téléphoniques et postales publiées doivent être confirmées par l'exploitant.</p>
    <h2>Hébergement et paiements</h2><p>L'application utilise Supabase pour les services de données et Stripe pour le paiement. ChargeNow intervient pour les opérations techniques des bornes et batteries. L'hébergeur web de production et les informations nécessaires sur les prestataires seront inscrits ici avant ouverture commerciale.</p>
    <h2>Propriété intellectuelle</h2><p>La marque, les textes, les visuels et le logiciel Chargeurs.ch sont protégés selon leurs titulaires respectifs. Les composants tiers restent soumis à leurs licences.</p>
    <h2>État de publication</h2><p>Cette page est techniquement intégrée au pilote. Les informations juridiques signalées comme incomplètes doivent être complétées et approuvées avant l'ouverture commerciale au public.</p>
  </>;
}

export default function LegalPage() {
  const { kind } = useParams<{ kind: LegalKind }>();
  const selected: LegalKind = kind === "conditions" || kind === "confidentialite" || kind === "mentions-legales" ? kind : "mentions-legales";
  return (
    <div className="relative min-h-screen">
      <LiquidBackground /><PublicNav />
      <main className="mx-auto max-w-4xl px-6 pb-20 pt-32 sm:px-10">
        <article className="glass-strong liquid-border rounded-3xl p-8 sm:p-12">
          <p className="text-sm font-semibold text-primary">Chargeurs.ch · version du {LEGAL_VERSION}</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold">{TITLES[selected]}</h1>
          <div className="prose prose-invert mt-8 max-w-none prose-headings:font-display prose-p:text-muted-foreground">
            {selected === "conditions" ? <Conditions /> : selected === "confidentialite" ? <Privacy /> : <LegalNotice />}
          </div>
          <div className="mt-10 flex flex-wrap gap-4 text-sm font-semibold text-primary">
            <Link to="/legal/conditions">Conditions</Link><Link to="/legal/confidentialite">Confidentialité</Link><Link to="/legal/mentions-legales">Mentions légales</Link>
          </div>
        </article>
      </main>
    </div>
  );
}
