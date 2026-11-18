# NovaTerm: shell integration para bash (Git Bash). Se carga con --init-file.
# Emite OSC 133 (prompt/comando/fin con código), OSC 633;E (texto del comando) y OSC 7 (carpeta).
if [ -z "$__NT_INIT" ]; then
  __NT_INIT=1
  # --init-file no es shell de login: se carga a mano lo que haría --login.
  [ -r /etc/profile ] && . /etc/profile
  if [ -r ~/.bash_profile ]; then . ~/.bash_profile
  elif [ -r ~/.bash_login ]; then . ~/.bash_login
  elif [ -r ~/.profile ]; then . ~/.profile
  elif [ -r ~/.bashrc ]; then . ~/.bashrc
  fi
fi

__nt_esc() {
  local s=${1//\\/\\\\}
  s=${s//;/\\x3b}
  s=${s//$'\n'/\\x0a}
  printf '%s' "$s"
}

# PS0 se expande después de leer un comando y antes de ejecutarlo. El subíndice aritmético
# marca __nt_started en el shell actual; la sustitución imprime el comando y el inicio.
__nt_ps0() {
  local cmd
  cmd=$(HISTTIMEFORMAT= builtin history 1 | sed 's/^ *[0-9]* *//')
  printf '\e]633;E;%s\a\e]133;C\a' "$(__nt_esc "$cmd")"
}
PS0='${__nt_arr[(__nt_started=1)]}$(__nt_ps0)'

__nt_precmd() {
  local ec=$?
  if [ -n "$__nt_started" ]; then printf '\e]133;D;%s\a' "$ec"; fi
  __nt_started=
  local dir
  dir=$(pwd -W 2>/dev/null || pwd)
  printf '\e]7;file://%s/%s\a' "${HOSTNAME:-localhost}" "${dir// /%20}"
  return $ec
}

__nt_wrap_ps1() {
  case "$PS1" in
    *'133;A'*) ;;
    *) PS1='\[\e]133;A\a\]'"$PS1"'\[\e]133;B\a\]' ;;
  esac
}

PROMPT_COMMAND="__nt_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __nt_wrap_ps1"
