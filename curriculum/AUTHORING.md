# Authoring brief: physics program course files

Learner: an organic chemist working through "The Long Curriculum", a self-study program in physics, chemistry,
computing and adjacent fields (things they've always wanted to learn). The physics spine: (BS/MS-level chemistry, did p-chem and calculus long ago, "bad at math,
forgot the shortcuts"). Goal: in ~2.5 years at ~8 h/week, reach first-year-PhD-level physics,
with deep core (math, mechanics, E&M, QM, stat mech) and survey depth for particle, astro, GR, and QFT.
Teaching is done by an AI tutor that reads each lesson's objectives and readings. Write
objectives so precise that a tutor knows exactly what "mastered" means.

## Files
- Schema: `src/core/contracts/curriculum.ts` (`courseSchema`). Read it first.
- Books catalog: `curriculum/books.json`. Use ONLY these `bookId`s.
- Write `curriculum/physics/courses/<courseId>.json` (tab-indented JSON).
- Validate: `npx tsx scripts/validate-curriculum.ts <courseId>` must print no ERROR and no SCHEMA lines.
  Fix every warning about the hour share too.

## Rules
- **Ids**: lowercase kebab-case, globally unique, prefixed with the course code, e.g. course `p5-em`,
  units `p5-u01-electrostatics`, lessons `p5-l001-coulomb-superposition`, exams `p5-midterm`, `p5-final`, `p5-placement`.
- **Size**: the sum of lesson `minutes` must be 60–75% of the course `hours` (the rest is problem sets and exams).
  Lessons are SHORT: 30–45 min each (reading + tutor session + the 3–4 question quick check; a longer lecture video is fine, its overflow doesn't count). One lesson = one idea, 2–3 objectives.
- **Lessons**: 2–3 `objectives` each (one coherent idea per lesson), phrased as observable skills ("Derive …", "Compute …", "Explain why …").
  Include `keyEquations` as LaTeX without `$`. Give MOST lessons `demoIdeas` (1–2 one-line briefs for an interactive browser
  simulation: what the learner manipulates and what they see); skip only lessons where a demo would be decoration. Add `practice` pointers to real
  end-of-chapter exercises of the primary book ("Griffiths EM Problem 2.15") only when you are confident they exist
  and fit. Otherwise leave them out.
- **Readings**: `{bookId, ref, title}`, where `ref` is the section number as printed in that edition
  (e.g. "§2.3" or "2.3") and `title` is that section's printed title. Accuracy matters: these get matched against the PDF
  outline later. Use the edition in books.json. If unsure of a section number, cite the chapter ("Ch. 4") with the
  chapter title instead of guessing. Mark supplementary readings `optional: true`.
- **Lectures**: include lecture links ONLY for URLs you have verified with WebFetch/WebSearch in this session
  (MIT OCW course pages and lecture video pages, official YouTube playlists such as 3Blue1Brown or MIT OCW). Budget:
  at most ~8 web calls per course. Prefer one verified playlist/course page on each unit's first lesson, plus specific
  lecture video pages where the fetched course page lists them. NEVER invent a URL or video id.
- **Units**: 4–10 units per course with a one-sentence `summary`. Mark beyond-undergrad units `"grad": true`.
- **Exams**: every course has a `midterm` (first half of units, 90–120 min, passMark 0.7) and a `final` (all units,
  150–180 min, passMark 0.7). Courses M0–M4, P1, P2 also get a `placement` (all units, 60–90 min, passMark 0.8)
  so the chemist can test out of what they already know.
- **Order**: lessons in teaching order. The previous lesson is an implicit prerequisite, so only list `prereqs` for
  earlier lessons in the SAME course that are non-adjacent but essential. Cross-course dependencies are handled
  at course level (see below), so don't list lessons of other courses.
- **Project capstone** (AI track and M7; optional elsewhere): a course-level `project` (`courseProjectSchema`):
  `{title, summary, goals (2–6), steps (3–10), stack, hours}`. A hands-on coding project that pulls the course
  together (e.g. A4: build and train a tiny GPT). It is optional and off the lesson path, so lessons never depend on it.
  Steps are concrete milestones the learner can check off; `stack` names the tools (Python, NumPy, PyTorch…);
  `hours` is a realistic estimate (8–30). The learner runs code on their own PC; a tutor mentors the project.
- **For the chemist**: where a topic connects to chemistry (orbitals, spectroscopy, thermodynamics, partition
  functions, Boltzmann factors, NMR spin), say so in an objective or the unit summary. It's a hook for the tutor.

## Course table (use exactly these values for id/code/track/depth/hours/prereqs/subject)

| id | code | title | track | depth | hours | prereqs | subject |
|---|---|---|---|---|---|---|---|
| m0-precalc | M0 | Algebra, Trigonometry & Precalculus Toolkit | math | core | 35 | – | Algebra & Precalc |
| m1-calculus | M1 | Calculus I–II | math | core | 55 | m0-precalc | Calculus |
| m2-multivariable | M2 | Multivariable & Vector Calculus | math | core | 45 | m1-calculus | Calculus |
| m3-linear-algebra | M3 | Linear Algebra | math | core | 50 | m1-calculus | Linear Algebra |
| m4-odes | M4 | Ordinary Differential Equations | math | core | 40 | m1-calculus, m3-linear-algebra | Differential Equations |
| m5-methods | M5 | Mathematical Methods: Fourier, PDEs, Special Functions, Green's Functions, Variational Calculus, Tensors | math | core | 60 | m2-multivariable, m4-odes | Math Methods |
| m6-complex | M6 | Complex Analysis for Physicists | math | core | 30 | m2-multivariable | Complex Analysis |
| p1-mechanics | P1 | Physics 1: Mechanics | physics | core | 75 | m1-calculus | Mechanics |
| p2-em-waves | P2 | Physics 2: Electricity, Magnetism, Waves & Optics | physics | core | 75 | p1-mechanics, m2-multivariable | Electromagnetism |
| p3-modern | P3 | Special Relativity & Modern Physics | physics | core | 30 | p2-em-waves | Relativity |
| p4-classical | P4 | Classical Mechanics | physics | core | 90 | p1-mechanics, m3-linear-algebra, m4-odes | Mechanics |
| p5-em | P5 | Electromagnetism | physics | core | 110 | p2-em-waves, m5-methods | Electromagnetism |
| p6-quantum | P6 | Quantum Mechanics | physics | core | 130 | p3-modern, m3-linear-algebra, m5-methods | Quantum |
| p7-statmech | P7 | Thermal & Statistical Physics | physics | core | 60 | p1-mechanics, m2-multivariable | Thermal & Statistical |
| s1-particles | S1 | Particle Physics | survey | survey | 35 | p6-quantum | Particles & Fields |
| s2-astro | S2 | Astrophysics & Cosmology | survey | survey | 35 | p3-modern, p7-statmech | Astrophysics |
| s3-gr | S3 | General Relativity | survey | survey | 45 | p4-classical, m5-methods | Relativity |
| s4-qft | S4 | Quantum Field Theory | survey | survey | 55 | p6-quantum, p5-em, p4-classical | Particles & Fields |
| m7-probability | M7 | Probability & Statistics | math | core | 35 | m1-calculus | Probability & Statistics |
| a1-machine-learning | A1 | Machine Learning | ai | core | 60 | m2-multivariable, m3-linear-algebra, m7-probability | Machine Learning |
| a2-neural-networks | A2 | Neural Networks | ai | core | 40 | a1-machine-learning | Neural Networks |
| a3-deep-learning | A3 | Deep Learning | ai | core | 55 | a2-neural-networks | Deep Learning |
| a4-modern-ai | A4 | Modern AI: Transformers & LLMs | ai | core | 65 | a3-deep-learning | Modern AI |
| q-qualifier | Q | Qualifier Review: Comprehensive Problem Solving | capstone | capstone | 30 | p4-classical, p5-em, p6-quantum, p7-statmech | Qualifier |

Course content notes:
- M0: the "shortcuts": algebraic manipulation, exponent/log rules, factoring, completing the square, inequalities,
  functions and transformations, trig (unit circle, identities, small-angle), exponentials, vectors basics,
  order-of-magnitude estimation, dimensional analysis, approximations (binomial). Books: openstax-precalc.
- M1: limits, derivatives and rules, implicit differentiation, related rates, optimisation, integrals, FTC, techniques
  (substitution, parts, partial fractions, trig substitution), improper integrals, sequences/series, Taylor series
  and approximations (heavy physics use), intro to differentials. Books: openstax-calc1, openstax-calc2.
- M2: vectors, dot/cross, partial derivatives, gradient, chain rule, multiple integrals, polar/cylindrical/spherical
  coordinates and Jacobians, div/grad/curl, line/surface integrals, Green/Stokes/divergence theorems, vector
  identities. Books: openstax-calc3, boas (ch. 4–6).
- M3: Strang: systems, elimination, matrices, vector spaces, rank, orthogonality, projections/least squares,
  determinants, eigenvalues/eigenvectors, diagonalisation, symmetric matrices/spectral theorem, complex vectors and
  Hermitian/unitary matrices (essential for QM), SVD, linear transformations, change of basis, inner product spaces.
- M4: first-order ODEs, linear 2nd-order with constant coefficients, damped/driven oscillators, resonance,
  Laplace transforms, systems of ODEs via eigenvalues, phase portraits, series solutions/Frobenius intro, numerical
  methods intro. Books: boas (ch. 8) + MIT 18.03.
- M5 (Boas): Fourier series and transforms, delta function, separation of variables (Laplace, heat, wave equations in
  Cartesian/cylindrical/spherical), Legendre polynomials and spherical harmonics, Bessel functions, Sturm–Liouville,
  Green's functions, calculus of variations (Euler–Lagrange), tensors and index notation.
- M6 (Boas ch. 14): complex numbers, analytic functions, Cauchy–Riemann, contour integration, Cauchy's theorem and
  formula, Laurent series, residues, evaluating real integrals, branch cuts, applications (Fourier integrals,
  Kramers–Kronig intro).
- P1: kinematics, Newton's laws, energy, momentum, rotation, angular momentum, oscillations, gravitation, fluids
  (brief). Book openstax-up1.
- P2: electrostatics, Gauss, potential, capacitance, circuits, magnetism, induction, Maxwell intro, EM waves,
  waves and sound, optics and interference (up2 + up3 ch. 1–4).
- P3: special relativity (Lorentz transformations, spacetime, 4-vectors, E = mc^2), photons, de Broglie, Bohr atom, intro
  wave mechanics, atoms, nuclear basics (openstax-up3).
- P4 (Taylor): Newtonian review, projectiles with drag, momentum/energy, oscillations, calculus of variations,
  Lagrangian mechanics, central forces/Kepler, non-inertial frames, rigid bodies, coupled oscillators/normal modes,
  Hamiltonian mechanics, chaos intro. Grad units: Poisson brackets, canonical transformations, Hamilton–Jacobi,
  action-angle (goldstein, tong-dynamics).
- P5 (Griffiths EM 4e): vector analysis review, electrostatics, potentials (Laplace, images, separation, multipoles),
  fields in matter, magnetostatics, magnetic fields in matter, electrodynamics, conservation laws, EM waves,
  potentials and fields, radiation, relativistic electrodynamics. Grad units (jackson): Green's-function boundary-value
  problems, multipole expansions, radiation from localised sources, waveguides.
- P6 (Griffiths QM 3e + sakurai): wavefunction, TISE, infinite well, harmonic oscillator (ladder operators), free
  particle, delta/finite well, formalism (Hilbert space, Dirac notation, operators, uncertainty), 3D QM/hydrogen,
  angular momentum and spin, identical particles, time-independent perturbation theory, variational principle, WKB,
  time-dependent perturbation theory / Fermi golden rule, scattering intro. Grad units (sakurai ch. 1–3, 4, 5):
  Stern–Gerlach and kets, time evolution pictures, angular momentum addition and Clebsch–Gordan, Wigner–Eckart intro,
  symmetries. Chemistry hooks: hydrogen orbitals, spin, spectroscopy selection rules, NMR.
- P7 (Schroeder; tong-statmech): energy and the first law, the second law/entropy, interactions and implications,
  engines (brief: the chemist knows this), free energy and chemical thermodynamics (brief), Boltzmann statistics,
  partition functions, quantum statistics (Fermi–Dirac, Bose–Einstein, blackbody, Debye), systems of interacting
  particles (Ising, mean field), phase transitions. Grad unit: ensembles formalism, fluctuations.
- S1 (griffiths-particles): history and the particle zoo, relativistic kinematics, symmetries, bound states, Feynman
  calculus (golden rule, toy theory), QED, QCD, weak interactions, gauge theories and the Higgs (qualitative-to-
  semi-quantitative).
- S2 (ryden + carroll-ostlie): stellar observables, radiation and spectra, stellar structure basics, stellar
  evolution and compact objects, galaxies, the expanding universe, Friedmann equations, cosmological models,
  CMB, nucleosynthesis, dark matter/energy, inflation.
- S3 (hartle + carroll-gr-notes): equivalence principle, spacetime geometry, geodesics, Schwarzschild solution,
  orbits and light bending, black holes, gravitational waves (linearised), then tensors/curvature/Einstein equation,
  cosmology in GR.
- S4 (lancaster-blundell + tong-qft): why QFT, classical field theory and Noether, second quantisation, free scalar
  field, propagators, interacting fields and perturbation theory, Wick's theorem and Feynman diagrams, Dirac
  equation, QED processes at tree level, renormalisation (conceptual), gauge symmetry and Higgs (conceptual).
- Q (cahn-nadgorny): topic-mixed problem sessions in qualifier style: mechanics, E&M, QM, stat mech, plus
  estimation and "mixed" problems. Lessons here are problem-solving workshops (objectives = problem classes).
  Midterm and final are mock qualifying exams.
- M7 (blitzstein-prob primary, openintro-stats secondary): probability rules and counting, conditional probability
  and Bayes (diagnostic tests, spectral assignment), random variables, expectation/variance, common distributions
  (binomial, Poisson — counting statistics in detectors and MS, normal, exponential/decay), joint distributions and
  covariance, LLN and CLT, estimation (maximum likelihood, bias/variance of estimators), Bayesian inference and conjugate
  priors, confidence intervals and hypothesis tests, linear regression and error propagation for lab data. Placement exam.
  Project: a Python analysis of a real or simulated data set (e.g. Poisson counting, a calibration curve with errors).
- A1 (bishop-prml primary, islp + shalev-shwartz-uml + rasmussen-gpml secondary/reference): the learning problem (loss,
  risk, generalization), linear regression (least squares as projection — tie to M3) and regularization (ridge/lasso,
  MAP view), logistic regression and softmax (softmax = Boltzmann distribution — the chemist's hook), GLMs,
  bias–variance, cross-validation and model selection, kernels and SVMs, Gaussian processes, trees and ensembles
  (bagging, random forests, boosting), unsupervised learning (k-means, Gaussian mixtures and EM, PCA via SVD),
  and grad units: learning theory (PAC, VC dimension, generalization bounds) and probabilistic graphical models.
  Project: implement and compare models from scratch in NumPy on a real data set (e.g. a chemistry/spectra data set).
- A2 (nielsen-nndl primary, prince-udl + goodfellow-dl secondary): perceptron and linear separability, multilayer
  networks and universal approximation, backpropagation derived by hand, computational graphs and reverse-mode
  automatic differentiation, optimization (SGD, momentum, Adam, schedules, loss landscapes), initialization and
  vanishing/exploding gradients, regularization (weight decay, dropout, early stopping, augmentation), energy-based
  models (Hopfield networks, Boltzmann machines — tie to the Ising model and partition functions of P7).
  Project: a tiny autograd engine plus an MLP trained with it (micrograd-style).
- A3 (prince-udl primary, bishop-dl + goodfellow-dl secondary): convolutional networks, normalization and residual
  networks, recurrent networks/LSTM/GRU, attention as a mechanism, representation learning and embeddings, generative
  models (VAEs, GANs, normalizing flows, diffusion models via score matching and Langevin dynamics — tie to stat mech),
  training at scale (batching, mixed precision, data pipelines), deep learning in science (molecular property
  prediction and graph neural networks, AlphaFold, spectra). Project: a CNN and a small diffusion model in PyTorch.
- A4 (prince-udl + jurafsky-slp primary, sutton-barto-rl secondary, bishop-dl reference): tokenization and
  embeddings, the transformer in detail (self-attention, multi-head, positional encodings, residual stream, layer
  norm), pretraining objectives (next-token, masked) and scaling laws, fine-tuning/instruction tuning/parameter-efficient
  methods (LoRA), reinforcement learning basics (MDPs, value functions, policy gradients) then RLHF and preference
  optimization (DPO), in-context learning, prompting and retrieval-augmented generation, agents and tool use,
  multimodal models, interpretability (probing, superposition and features, circuits), evaluation, alignment and
  safety. Mark the RL theory, interpretability and alignment units `grad` where they go beyond an intro.
  Project: build and train a tiny GPT on a small text corpus in PyTorch, then probe what it learned.
- AI-track and M7 readings: the free books' printed section numbers. Where only an online version exists
  (nielsen-nndl, jurafsky-slp drafts), cite chapters ("Ch. 2") with their titles.
